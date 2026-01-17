/**
 * 스토리 구성 웹학습지 - 인증 관련 함수
 *
 * @version 1.0.0
 */

// ============================================
// 학생 로그인 (PIN 방식)
// ============================================

/**
 * 이름+번호+PIN으로 학생 로그인
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @param {string} pin - 6자리 PIN
 * @returns {object} { success, name?, number?, error?, needSetPin? }
 */
function loginStudent(name, number, pin) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  const pinValidation = validatePin(pin);
  if (!pinValidation.valid) {
    return { success: false, error: pinValidation.error };
  }

  // Rate Limiting 체크 (무차별 대입 공격 방어)
  const identifier = `student:${nameValidation.value}:${numberValidation.value}`;
  const rateCheck = RateLimiter.checkLimit(identifier, 'login');
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `너무 많은 로그인 시도입니다. ${rateCheck.retryAfter}분 후에 다시 시도해주세요.`,
      rateLimited: true,
      retryAfter: rateCheck.retryAfter
    };
  }

  // 학생 찾기 (캐시 사용)
  const student = DataCache.findStudent(nameValidation.value, numberValidation.value);

  if (!student) {
    RateLimiter.recordAttempt(identifier, 'login');
    return { success: false, error: '등록되지 않은 학생입니다.' };
  }

  // 상태 확인
  if (student.status === 'pending') {
    return {
      success: false,
      error: 'PIN 설정이 필요합니다.',
      needSetPin: true,
      name: student.name,
      number: student.number
    };
  }

  if (student.status === 'inactive') {
    return { success: false, error: '비활성화된 계정입니다.' };
  }

  // PIN 검증
  const inputPinHash = hashPin(pinValidation.value);
  if (student.pinHash !== inputPinHash) {
    RateLimiter.recordAttempt(identifier, 'login');
    return { success: false, error: 'PIN이 올바르지 않습니다.' };
  }

  // 로그인 성공 - Rate Limiter 초기화
  RateLimiter.resetAttempts(identifier, 'login');

  // 마지막 접속 시간 업데이트
  updateLastAccess(student.row);

  return {
    success: true,
    name: student.name,
    number: student.number,
    token: student.token
  };
}

// ============================================
// 학생 로그인 (QR/토큰 방식)
// ============================================

/**
 * 토큰으로 학생 바로 로그인 (QR 스캔용)
 * @param {string} token - 학생 토큰
 * @returns {object} { success, name?, number?, error? }
 */
function loginStudentByToken(token) {
  if (!token || typeof token !== 'string') {
    return { success: false, error: '유효하지 않은 QR입니다.' };
  }

  // 캐시된 토큰 검색 사용 (O(1) 해시 조회)
  const student = DataCache.findStudentByToken(token.trim());

  if (!student) {
    return { success: false, error: '유효하지 않은 QR입니다.' };
  }

  if (student.status !== 'active') {
    return { success: false, error: '사용할 수 없는 계정입니다.' };
  }

  // 마지막 접속 시간 업데이트
  updateLastAccess(student.row);

  return {
    success: true,
    name: student.name,
    number: student.number,
    token: student.token
  };
}

// ============================================
// PIN 설정 (첫 접속)
// ============================================

/**
 * pending 상태 학생이 처음 PIN을 설정
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @param {string} pin - 6자리 PIN
 * @returns {object} { success, error? }
 */
function setStudentPin(name, number, pin) {
  // 입력값 검증
  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(number);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  const pinValidation = validatePin(pin);
  if (!pinValidation.valid) {
    return { success: false, error: pinValidation.error };
  }

  // 학생 찾기 (캐시 사용)
  const student = DataCache.findStudent(nameValidation.value, numberValidation.value);

  if (!student) {
    return { success: false, error: '등록되지 않은 학생입니다.' };
  }

  if (student.status !== 'pending') {
    return { success: false, error: '이미 PIN이 설정되어 있습니다.' };
  }

  // PIN 해시 생성 및 저장
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  const pinHash = hashPin(pinValidation.value);
  const now = new Date();

  // PIN해시 (3열), 마지막접속 (6열), 상태 (7열) 업데이트
  sheet.getRange(student.row, 3).setValue(pinHash);
  sheet.getRange(student.row, 6).setValue(now);
  sheet.getRange(student.row, 7).setValue('active');

  // 캐시 무효화 (학생 정보가 변경됨)
  DataCache.invalidateStudents();

  return {
    success: true,
    name: student.name,
    number: student.number,
    token: student.token
  };
}

// ============================================
// 학생 상태 확인
// ============================================

/**
 * 학생 상태 확인 (로그인 전 체크용)
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @returns {object} { success, status?, needSetPin?, error? }
 */
function checkStudentStatus(name, number) {
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
    return { success: false, error: '등록되지 않은 학생입니다.', notFound: true };
  }

  return {
    success: true,
    name: student.name,
    number: student.number,
    status: student.status,
    needSetPin: student.status === 'pending'
  };
}

// ============================================
// 헬퍼 함수
// ============================================

/**
 * 이름+번호로 학생 찾기
 * @param {string} name - 학생 이름
 * @param {number} number - 학생 번호
 * @returns {object|null} 학생 객체 또는 null
 */
function findStudent(name, number) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name && data[i][1] === number) {
      return rowToStudent(data[i], i + 1);
    }
  }

  return null;
}

/**
 * 토큰으로 학생 찾기
 * @param {string} token - 학생 토큰
 * @returns {object|null} 학생 객체 또는 null
 */
function findStudentByToken(token) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === token) {
      return rowToStudent(data[i], i + 1);
    }
  }

  return null;
}

/**
 * 마지막 접속 시간 업데이트
 * @param {number} row - 학생 행 번호
 */
function updateLastAccess(row) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
  if (sheet) {
    sheet.getRange(row, 6).setValue(new Date());
  }
}

// ============================================
// 교사 인증
// ============================================

/**
 * 교사 PIN으로 로그인
 * @param {string} pin - 교사 PIN (4-6자리)
 * @returns {object} { success, error?, teacherToken? }
 */
function loginTeacher(pin) {
  if (!pin || typeof pin !== 'string') {
    return { success: false, error: 'PIN을 입력해주세요.' };
  }

  // Rate Limiting 체크 (무차별 대입 공격 방어)
  const identifier = 'teacher';
  const rateCheck = RateLimiter.checkLimit(identifier, 'login');
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `너무 많은 로그인 시도입니다. ${rateCheck.retryAfter}분 후에 다시 시도해주세요.`,
      rateLimited: true,
      retryAfter: rateCheck.retryAfter
    };
  }

  const settings = getSettings();

  // 교사 PIN이 설정되어 있는지 확인
  if (!settings.teacherPinHash) {
    return { success: false, error: '교사 PIN이 설정되지 않았습니다.', needSetup: true };
  }

  // PIN 검증
  const inputHash = hashTeacherPin(pin);
  if (inputHash !== settings.teacherPinHash) {
    RateLimiter.recordAttempt(identifier, 'login');
    return { success: false, error: 'PIN이 올바르지 않습니다.' };
  }

  // 로그인 성공 - Rate Limiter 초기화
  RateLimiter.resetAttempts(identifier, 'login');

  // 교사 세션 토큰 생성 (1시간 유효)
  const teacherToken = generateTeacherToken();
  saveTeacherSession(teacherToken);

  return {
    success: true,
    teacherToken: teacherToken,
    teacherName: settings.teacherName || ''
  };
}

/**
 * 교사 PIN 설정 (첫 설정 또는 변경)
 * @param {string} pin - 새 PIN (4-6자리)
 * @param {string} currentPin - 현재 PIN (변경 시)
 * @returns {object} { success, error? }
 */
function setTeacherPin(pin, currentPin) {
  // PIN 유효성 검사
  if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
    return { success: false, error: 'PIN은 4~6자리 숫자여야 합니다.' };
  }

  const settings = getSettings();

  // 기존 PIN이 있으면 현재 PIN 확인
  if (settings.teacherPinHash) {
    if (!currentPin) {
      return { success: false, error: '현재 PIN을 입력해주세요.' };
    }
    const currentHash = hashTeacherPin(currentPin);
    if (currentHash !== settings.teacherPinHash) {
      return { success: false, error: '현재 PIN이 올바르지 않습니다.' };
    }
  }

  // 새 PIN 저장
  const newHash = hashTeacherPin(pin);
  const result = saveSettings({ teacherPinHash: newHash });

  if (result.success) {
    return { success: true, message: 'PIN이 설정되었습니다.' };
  } else {
    return { success: false, error: 'PIN 저장에 실패했습니다.' };
  }
}

/**
 * 교사 세션 확인
 * @param {string} teacherToken - 교사 토큰
 * @returns {object} { success, valid, error? }
 */
function verifyTeacherSession(teacherToken) {
  if (!teacherToken) {
    return { success: true, valid: false };
  }

  const settings = getSettings();
  const sessionData = settings.teacherSession;

  if (!sessionData) {
    return { success: true, valid: false };
  }

  try {
    const session = JSON.parse(sessionData);

    // 토큰 일치 확인
    if (session.token !== teacherToken) {
      return { success: true, valid: false };
    }

    // 만료 시간 확인 (1시간)
    const expiresAt = new Date(session.expiresAt);
    if (new Date() > expiresAt) {
      return { success: true, valid: false, expired: true };
    }

    return { success: true, valid: true };
  } catch (e) {
    return { success: true, valid: false };
  }
}

/**
 * Google 계정 기반 교사 권한 확인
 * @returns {object} { success, isAuthorized, email? }
 */
function checkGoogleAuth() {
  try {
    const currentUser = Session.getActiveUser();
    const email = currentUser.getEmail();

    // 이메일이 없으면 (배포 설정에 따라 다름)
    if (!email) {
      return {
        success: true,
        isAuthorized: false,
        reason: 'Google 계정 정보를 가져올 수 없습니다.'
      };
    }

    // 스프레드시트 편집 권한 확인
    const ss = SpreadsheetApp.getActive();
    const editors = ss.getEditors().map(e => e.getEmail());
    const owner = ss.getOwner().getEmail();

    const isAuthorized = email === owner || editors.includes(email);

    return {
      success: true,
      isAuthorized: isAuthorized,
      email: email,
      isOwner: email === owner
    };
  } catch (e) {
    // Session.getActiveUser()가 실패하는 경우
    return {
      success: true,
      isAuthorized: false,
      reason: '권한 확인 실패: ' + e.message
    };
  }
}

/**
 * 교사 인증 종합 확인 (PIN 또는 Google 계정)
 * @param {string} teacherToken - 교사 세션 토큰 (선택)
 * @returns {object} { success, isAuthorized, method? }
 */
function isTeacherAuthorized(teacherToken) {
  // 1. PIN 세션 확인
  if (teacherToken) {
    const sessionCheck = verifyTeacherSession(teacherToken);
    if (sessionCheck.valid) {
      return { success: true, isAuthorized: true, method: 'pin' };
    }
  }

  // 2. Google 계정 확인
  const googleCheck = checkGoogleAuth();
  if (googleCheck.isAuthorized) {
    return { success: true, isAuthorized: true, method: 'google', email: googleCheck.email };
  }

  return { success: true, isAuthorized: false };
}

// ============================================
// 교사 인증 헬퍼 함수
// ============================================

/**
 * 교사 PIN 해시 생성
 * @param {string} pin - 원본 PIN
 * @returns {string} 해시값
 */
function hashTeacherPin(pin) {
  const settings = getSettings();
  const salt = settings.pinSalt || 'default-salt';
  const input = 'teacher:' + pin + ':' + salt;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return Utilities.base64Encode(hash);
}

/**
 * 교사 세션 토큰 생성
 * @returns {string} 토큰
 */
function generateTeacherToken() {
  return Utilities.getUuid();
}

/**
 * 교사 세션 저장
 * @param {string} token - 세션 토큰
 */
function saveTeacherSession(token) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1); // 1시간 유효

  const sessionData = JSON.stringify({
    token: token,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString()
  });

  saveSettings({ teacherSession: sessionData });
}

/**
 * 교사 로그아웃 (세션 무효화)
 * @returns {object} { success }
 */
function logoutTeacher() {
  saveSettings({ teacherSession: '' });
  return { success: true };
}
