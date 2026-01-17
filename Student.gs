/**
 * 스토리 구성 웹학습지 - 학생 관리 함수 (교사용)
 *
 * @version 1.0.0
 */

// ============================================
// 학생 등록 (교사용)
// ============================================

/**
 * 교사가 학생을 등록 (선등록 방식)
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @param {string} pin - PIN (선택, 없으면 학생이 직접 설정)
 * @returns {object} { success, token?, status?, error? }
 */
function registerStudentByTeacher(name, number, pin = null) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  // 중복 확인
  const existing = findStudent(nameValidation.value, numberValidation.value);
  if (existing) {
    return { success: false, error: '이미 등록된 학생입니다.' };
  }

  // 시트 가져오기
  const sheet = getOrCreateSheet(SHEET_NAMES.STUDENTS);

  // 토큰 생성
  const token = generateToken();
  const now = new Date();

  // PIN 처리
  let pinHash = '';
  let status = 'pending';

  if (pin) {
    const pinValidation = validatePin(pin);
    if (pinValidation.valid) {
      pinHash = hashPin(pinValidation.value);
      status = 'active';
    }
  }

  // 저장: 이름, 번호, PIN해시, 토큰, 등록일, 마지막접속, 상태
  sheet.appendRow([
    nameValidation.value,
    numberValidation.value,
    pinHash,
    token,
    now,
    '',
    status
  ]);

  // 캐시 무효화 (학생 목록이 변경됨)
  DataCache.invalidateStudents();

  return {
    success: true,
    name: nameValidation.value,
    number: numberValidation.value,
    token: token,
    status: status
  };
}

// ============================================
// 학생 일괄 등록 (CSV)
// ============================================

/**
 * CSV 데이터로 학생 일괄 등록
 * @param {string} csvData - CSV 문자열 (이름,번호)
 * @param {string} pinMode - "student" (학생 직접 설정) 또는 "default" (번호 6자리)
 * @returns {object} { success, added, skipped, errors[] }
 */
function importStudents(csvData, pinMode = 'student') {
  if (!csvData || typeof csvData !== 'string') {
    return { success: false, error: 'CSV 데이터가 없습니다.' };
  }

  const rows = Utilities.parseCsv(csvData);
  const results = {
    success: true,
    added: 0,
    skipped: 0,
    errors: []
  };

  // 헤더 제외하고 처리 (첫 행이 헤더인 경우)
  const startIndex = (rows[0] && isNaN(parseInt(rows[0][1]))) ? 1 : 0;

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const name = row[0] ? row[0].trim() : '';
    const number = parseInt(row[1], 10);

    if (!name || isNaN(number)) {
      results.skipped++;
      results.errors.push({ row: i + 1, name, error: '형식 오류' });
      continue;
    }

    // PIN 결정
    let pin = null;
    if (pinMode === 'default') {
      // 기본 PIN: 번호를 6자리로 패딩
      pin = String(number).padStart(6, '0');
    }

    const result = registerStudentByTeacher(name, number, pin);

    if (result.success) {
      results.added++;
    } else {
      results.skipped++;
      results.errors.push({ row: i + 1, name, number, error: result.error });
    }
  }

  return results;
}

// ============================================
// 전체 학생 조회
// ============================================

/**
 * 모든 학생 목록 조회
 * @returns {object} { success, data[] }
 */
function getAllStudents() {
  // 캐시 사용하여 학생 조회
  const cachedStudents = DataCache.getStudents();

  if (!cachedStudents || cachedStudents.length === 0) {
    return { success: true, data: [] };
  }

  const students = [];

  for (const student of cachedStudents) {
    students.push({
      name: student.name,
      number: student.number,
      hasPin: !!student.pinHash,
      token: student.token,
      createdAt: formatDate(student.createdAt),
      lastAccessAt: student.lastAccessAt ? formatDate(student.lastAccessAt) : null,
      lastAccessRelative: student.lastAccessAt ? getRelativeTime(student.lastAccessAt) : '없음',
      status: student.status
    });
  }

  // 번호순 정렬
  students.sort((a, b) => a.number - b.number);

  return { success: true, data: students };
}

// ============================================
// PIN 재설정 (교사용)
// ============================================

/**
 * 교사가 학생 PIN을 재설정
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @param {string} newPin - 새 PIN
 * @returns {object} { success, error? }
 */
function resetStudentPin(name, number, newPin) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  const pinValidation = validatePin(newPin);
  if (!pinValidation.valid) {
    return { success: false, error: pinValidation.error };
  }

  // 학생 찾기 (캐시 사용)
  const student = DataCache.findStudent(nameValidation.value, numberValidation.value);

  if (!student) {
    return { success: false, error: '학생을 찾을 수 없습니다.' };
  }

  // PIN 해시 업데이트
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  const newHash = hashPin(pinValidation.value);

  sheet.getRange(student.row, 3).setValue(newHash);

  // pending이었다면 active로 변경
  if (student.status === 'pending') {
    sheet.getRange(student.row, 7).setValue('active');
  }

  // 캐시 무효화
  DataCache.invalidateStudents();

  return { success: true };
}

// ============================================
// QR 토큰 재발급 (교사용)
// ============================================

/**
 * 기존 QR이 유출되었을 때 새 토큰 발급
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @returns {object} { success, token?, error? }
 */
function regenerateToken(name, number) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  // 학생 찾기 (캐시 사용)
  const student = DataCache.findStudent(nameValidation.value, numberValidation.value);

  if (!student) {
    return { success: false, error: '학생을 찾을 수 없습니다.' };
  }

  // 새 토큰 생성
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  const newToken = generateToken();

  sheet.getRange(student.row, 4).setValue(newToken);

  // 캐시 무효화
  DataCache.invalidateStudents();

  return { success: true, token: newToken };
}

// ============================================
// 학생 상태 변경 (교사용)
// ============================================

/**
 * 학생 상태 변경
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @param {string} status - 새 상태 (active/inactive)
 * @returns {object} { success, error? }
 */
function updateStudentStatus(name, number, status) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  if (!['active', 'inactive'].includes(status)) {
    return { success: false, error: '올바른 상태를 선택해주세요.' };
  }

  // 학생 찾기 (캐시 사용)
  const student = DataCache.findStudent(nameValidation.value, numberValidation.value);

  if (!student) {
    return { success: false, error: '학생을 찾을 수 없습니다.' };
  }

  // pending 상태에서 active로 변경하려면 PIN이 있어야 함
  if (student.status === 'pending' && status === 'active' && !student.pinHash) {
    return { success: false, error: 'PIN이 설정되지 않아 활성화할 수 없습니다.' };
  }

  // 상태 업데이트
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  sheet.getRange(student.row, 7).setValue(status);

  // 캐시 무효화
  DataCache.invalidateStudents();

  return { success: true, status: status };
}

// ============================================
// 학생 삭제 (교사용)
// ============================================

/**
 * 학생 삭제
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @returns {object} { success, error? }
 */
function deleteStudent(name, number) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  // 학생 찾기 (캐시 사용)
  const student = DataCache.findStudent(nameValidation.value, numberValidation.value);

  if (!student) {
    return { success: false, error: '학생을 찾을 수 없습니다.' };
  }

  // 학생 삭제 (행 삭제)
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  sheet.deleteRow(student.row);

  // 캐시 무효화
  DataCache.invalidateStudents();

  // 관련 작품도 삭제할지 여부는 교사 판단에 맡김 (여기서는 학생만 삭제)

  return { success: true };
}

// ============================================
// 학생 데이터 내보내기 (CSV)
// ============================================

/**
 * 학생 데이터 CSV로 내보내기
 * @returns {object} { success, csv? }
 */
function exportStudentsAsCsv() {
  const result = getAllStudents();
  if (!result.success || !result.data.length) {
    return { success: false, error: '내보낼 학생이 없습니다.' };
  }

  const headers = ['이름', '번호', '등록일', '상태'];
  const rows = [headers.join(',')];

  for (const student of result.data) {
    rows.push([
      student.name,
      student.number,
      formatDateShort(student.createdAt),
      student.status
    ].join(','));
  }

  return { success: true, csv: rows.join('\n') };
}
