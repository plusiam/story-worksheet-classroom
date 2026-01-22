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

  // Lock Service - 동시 수정 충돌 방지
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return { success: false, error: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
    }

    // PIN 해시 생성 및 저장
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
    const pinHash = hashPin(pinValidation.value);
    const now = new Date();

    // PIN해시 (3열), 마지막접속 (6열), 상태 (7열) 업데이트 - 배치 쓰기 불가 (비연속 컬럼)
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
  } catch (e) {
    console.error('PIN 설정 오류:', e.message);
    return { success: false, error: 'PIN 설정 중 오류가 발생했습니다.' };
  } finally {
    lock.releaseLock();
  }
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
    name: getAdminName() || '' // TEACHERS 시트에서 admin 이름
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
 * 점조직 모델: 각 교사의 독립 GAS에서 실행됨
 * @returns {object} { success, isAuthorized, email?, teacher? }
 */
function checkGoogleAuth() {
  try {
    // Session.getActiveUser()는 GAS 환경에서만 작동
    // 웹앱 배포 시 "웹앱에 액세스하는 사용자"로 설정 필요
    let currentUser;
    try {
      currentUser = Session.getActiveUser();
    } catch (sessionError) {
      return {
        success: true,
        isAuthorized: false,
        reason: 'GAS 세션을 가져올 수 없습니다. 웹앱으로 접근해주세요.',
        debugInfo: sessionError.message
      };
    }

    if (!currentUser) {
      return {
        success: true,
        isAuthorized: false,
        reason: '사용자 세션이 없습니다. 다시 로그인해주세요.'
      };
    }

    const email = currentUser.getEmail();

    // 이메일이 없으면 (배포 설정에 따라 다름)
    if (!email) {
      return {
        success: true,
        isAuthorized: false,
        reason: 'Google 계정 정보를 가져올 수 없습니다. 웹앱 배포 설정을 확인해주세요.',
        hint: '웹앱 배포 시 "다음 사용자 인증 정보로 실행: 나" + "액세스 권한: 모든 사용자"로 설정하세요.'
      };
    }

    // TEACHERS 시트에서 이메일 확인
    const teacher = findTeacherByEmail(email);

    if (!teacher) {
      return {
        success: true,
        isAuthorized: false,
        email: email,
        reason: '등록되지 않은 교사입니다.'
      };
    }

    // 승인 상태 확인
    if (teacher.status === 'pending') {
      return {
        success: true,
        isAuthorized: false,
        email: email,
        status: 'pending',
        reason: '관리자 승인 대기 중입니다.'
      };
    }

    if (teacher.status !== 'approved') {
      return {
        success: true,
        isAuthorized: false,
        email: email,
        status: teacher.status,
        reason: '승인되지 않은 계정입니다.'
      };
    }

    return {
      success: true,
      isAuthorized: true,
      email: email,
      teacher: {
        name: teacher.name,
        role: teacher.role,
        email: teacher.email
      },
      isAdmin: teacher.role === 'admin'
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
 * Google OAuth로 교사 로그인
 * 점조직 모델: 각 교사의 GAS에서 Google 인증 처리
 * @returns {object} { success, teacher?, error? }
 */
function loginTeacherWithGoogle() {
  const authResult = checkGoogleAuth();

  if (!authResult.isAuthorized) {
    return {
      success: false,
      error: authResult.reason || '로그인 실패',
      status: authResult.status,
      email: authResult.email,
      hint: authResult.hint || null
    };
  }

  // teacher 객체 null 체크 (방어적 프로그래밍)
  if (!authResult.teacher) {
    return {
      success: false,
      error: '교사 정보를 가져올 수 없습니다.',
      email: authResult.email
    };
  }

  // 세션 토큰 생성
  const teacherToken = generateTeacherToken();
  saveTeacherSessionWithEmail(teacherToken, authResult.email);

  // 마지막 접속 시간 업데이트
  updateTeacherLastAccess(authResult.email);

  return {
    success: true,
    teacherToken: teacherToken,
    name: authResult.teacher.name || '',
    email: authResult.email,
    role: authResult.teacher.role || 'teacher',
    isAdmin: authResult.isAdmin || false
  };
}

/**
 * 이메일로 교사 찾기
 * @param {string} email - 이메일
 * @returns {object|null} 교사 정보
 */
function findTeacherByEmail(email) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);

    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().toLowerCase() === email.toLowerCase()) {
        return {
          row: i + 1,
          email: data[i][0],
          name: data[i][1],
          passwordHash: data[i][2],
          role: data[i][3],
          status: data[i][4],
          registeredAt: data[i][5],
          approvedAt: data[i][6],
          lastAccess: data[i][7]
        };
      }
    }

    return null;
  } catch (e) {
    console.log('findTeacherByEmail 오류:', e.message);
    return null;
  }
}

/**
 * 교사 마지막 접속 시간 업데이트
 * @param {string} email - 교사 이메일
 */
function updateTeacherLastAccess(email) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);

    if (!sheet) return;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().toLowerCase() === email.toLowerCase()) {
        sheet.getRange(i + 1, 8).setValue(new Date().toISOString()); // 마지막접속 컬럼
        break;
      }
    }
  } catch (e) {
    console.log('updateTeacherLastAccess 오류:', e.message);
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

// ============================================
// 다중 교사 관리 시스템
// ============================================

/**
 * 교사 회원가입
 * @param {string} email - 이메일
 * @param {string} name - 이름
 * @param {string} password - 비밀번호
 * @returns {object} { success, error?, needApproval? }
 */
function registerTeacher(email, name, password) {
  // 입력값 검증
  if (!email || !email.includes('@')) {
    return { success: false, error: '올바른 이메일을 입력해주세요.' };
  }
  if (!name || name.trim().length < 2) {
    return { success: false, error: '이름은 2자 이상 입력해주세요.' };
  }
  if (!password || password.length < 4) {
    return { success: false, error: '비밀번호는 4자리 이상이어야 합니다.' };
  }

  const sheet = getOrCreateSheet(SHEET_NAMES.TEACHERS);
  const data = sheet.getDataRange().getValues();

  // 이메일 중복 확인
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      return { success: false, error: '이미 등록된 이메일입니다.' };
    }
  }

  // 비밀번호 해시 생성
  const passwordHash = hashTeacherPassword(password);
  const now = new Date().toISOString();

  // 첫 번째 교사면 자동으로 admin + approved
  const isFirstTeacher = data.length <= 1;
  const role = isFirstTeacher ? 'admin' : 'teacher';
  const status = isFirstTeacher ? 'approved' : 'pending';
  const approvedAt = isFirstTeacher ? now : '';

  // 새 교사 추가
  sheet.appendRow([
    email.toLowerCase().trim(),
    name.trim(),
    passwordHash,
    role,
    status,
    now,
    approvedAt,
    ''
  ]);

  if (isFirstTeacher) {
    return {
      success: true,
      message: '관리자로 등록되었습니다. 바로 로그인할 수 있습니다.',
      isAdmin: true
    };
  }

  return {
    success: true,
    message: '가입 신청이 완료되었습니다. 관리자 승인 후 사용할 수 있습니다.',
    needApproval: true
  };
}

/**
 * 관리자가 직접 교사 추가 (Google OAuth용)
 * Lock Service로 동시 추가 충돌 방지
 * @param {string} email - 추가할 교사 이메일
 * @param {string} name - 교사 이름
 * @param {string} role - 역할 (teacher, viewer)
 * @param {string} adminEmail - 관리자 이메일
 * @returns {object} { success, error? }
 */
function addTeacherByAdmin(email, name, role, adminEmail) {
  // 관리자 권한 확인
  const adminCheck = checkAdminPermission(adminEmail);
  if (!adminCheck.isAdmin) {
    return { success: false, error: '관리자 권한이 필요합니다.' };
  }

  // 입력값 검증
  if (!email || !email.includes('@')) {
    return { success: false, error: '올바른 이메일을 입력해주세요.' };
  }
  if (!name || name.trim().length < 2) {
    return { success: false, error: '이름은 2자 이상 입력해주세요.' };
  }

  // Lock Service - 동시 추가 충돌 방지
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return { success: false, error: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
    }

    const sheet = getOrCreateSheet(SHEET_NAMES.TEACHERS);
    const data = sheet.getDataRange().getValues();

    // 이메일 중복 확인
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().toLowerCase() === email.toLowerCase()) {
        return { success: false, error: '이미 등록된 이메일입니다.' };
      }
    }

    const now = new Date().toISOString();
    const validRole = ['teacher', 'viewer', 'admin'].includes(role) ? role : 'teacher';

    // 새 교사 추가 (비밀번호 없이, Google OAuth 전용)
    sheet.appendRow([
      email.toLowerCase().trim(),
      name.trim(),
      '',  // 비밀번호 해시 없음 (Google OAuth 사용)
      validRole,
      'approved',  // 관리자가 추가하므로 바로 승인
      now,
      now,  // 승인일 = 등록일
      ''
    ]);

    return {
      success: true,
      message: `${name} 교사가 추가되었습니다.`
    };
  } catch (e) {
    console.error('교사 추가 오류:', e.message);
    return { success: false, error: '교사 추가 중 오류가 발생했습니다.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 교사 이메일/비밀번호 로그인
 * @param {string} email - 이메일
 * @param {string} password - 비밀번호
 * @returns {object} { success, teacher?, error? }
 */
function loginTeacherWithEmail(email, password) {
  if (!email || !password) {
    return { success: false, error: '이메일과 비밀번호를 입력해주세요.' };
  }

  // Rate Limiting
  const identifier = 'teacher:' + email.toLowerCase();
  const rateCheck = RateLimiter.checkLimit(identifier, 'login');
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `너무 많은 로그인 시도입니다. ${rateCheck.retryAfter}분 후에 다시 시도해주세요.`,
      rateLimited: true
    };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  if (!sheet) {
    return { success: false, error: '교사 데이터를 찾을 수 없습니다.' };
  }

  const data = sheet.getDataRange().getValues();
  let teacherRow = null;
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      teacherRow = data[i];
      rowIndex = i + 1;
      break;
    }
  }

  if (!teacherRow) {
    RateLimiter.recordAttempt(identifier, 'login');
    return { success: false, error: '등록되지 않은 이메일입니다.' };
  }

  // 비밀번호 확인
  const inputHash = hashTeacherPassword(password);
  if (teacherRow[2] !== inputHash) {
    RateLimiter.recordAttempt(identifier, 'login');
    return { success: false, error: '비밀번호가 올바르지 않습니다.' };
  }

  // 상태 확인
  const status = teacherRow[4];
  if (status === 'pending') {
    return { success: false, error: '관리자 승인 대기 중입니다.', needApproval: true };
  }
  if (status === 'rejected') {
    return { success: false, error: '가입이 거절되었습니다.' };
  }
  if (status === 'suspended') {
    return { success: false, error: '계정이 정지되었습니다.' };
  }

  // 로그인 성공
  RateLimiter.resetAttempts(identifier, 'login');

  // 마지막 접속 시간 업데이트
  sheet.getRange(rowIndex, 8).setValue(new Date().toISOString());

  // 세션 토큰 생성
  const teacherToken = generateTeacherToken();
  saveTeacherSessionWithEmail(teacherToken, email.toLowerCase());

  return {
    success: true,
    teacher: {
      email: teacherRow[0],
      name: teacherRow[1],
      role: teacherRow[3],
      status: teacherRow[4]
    },
    teacherToken: teacherToken
  };
}

/**
 * 교사 승인 (관리자 전용)
 * Lock Service로 동시 승인 충돌 방지
 * @param {string} email - 승인할 교사 이메일
 * @param {string} adminEmail - 승인하는 관리자 이메일
 * @returns {object} { success, error? }
 */
function approveTeacher(email, adminEmail) {
  // 관리자 권한 확인
  const adminCheck = checkAdminPermission(adminEmail);
  if (!adminCheck.isAdmin) {
    return { success: false, error: '관리자 권한이 필요합니다.' };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  if (!sheet) {
    return { success: false, error: '교사 데이터를 찾을 수 없습니다.' };
  }

  // Lock Service - 동시 승인 충돌 방지
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return { success: false, error: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
        if (data[i][4] !== 'pending') {
          return { success: false, error: '대기 상태가 아닙니다.' };
        }

        // 상태를 approved로 변경
        sheet.getRange(i + 1, 5).setValue('approved');
        sheet.getRange(i + 1, 7).setValue(new Date().toISOString());

        return { success: true, message: `${data[i][1]} 선생님이 승인되었습니다.` };
      }
    }

    return { success: false, error: '교사를 찾을 수 없습니다.' };
  } catch (e) {
    console.error('교사 승인 오류:', e.message);
    return { success: false, error: '교사 승인 중 오류가 발생했습니다.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 교사 가입 거절 (관리자 전용)
 * @param {string} email - 거절할 교사 이메일
 * @param {string} reason - 거절 사유
 * @returns {object} { success, error? }
 */
function rejectTeacher(email, reason) {
  const adminCheck = checkCurrentUserAdmin();
  if (!adminCheck.isAdmin) {
    return { success: false, error: '관리자 권한이 필요합니다.' };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  if (!sheet) {
    return { success: false, error: '교사 데이터를 찾을 수 없습니다.' };
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      sheet.getRange(i + 1, 5).setValue('rejected');
      return { success: true, message: '가입 요청이 거절되었습니다.' };
    }
  }

  return { success: false, error: '교사를 찾을 수 없습니다.' };
}

/**
 * 모든 교사 목록 조회 (관리자 전용)
 * @returns {object} { success, data?, error? }
 */
function getAllTeachers() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  if (!sheet) {
    return { success: true, data: [] };
  }

  const data = sheet.getDataRange().getValues();
  const teachers = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      teachers.push({
        email: data[i][0],
        name: data[i][1],
        role: data[i][3],
        status: data[i][4],
        registeredAt: data[i][5],
        approvedAt: data[i][6],
        lastLogin: data[i][7]
      });
    }
  }

  return { success: true, data: teachers };
}

/**
 * 교사 역할 변경 (관리자 전용)
 * @param {string} email - 대상 교사 이메일
 * @param {string} role - 새 역할 (admin, teacher)
 * @param {string} adminEmail - 변경하는 관리자 이메일
 * @returns {object} { success, error? }
 */
function updateTeacherRole(email, role, adminEmail) {
  const adminCheck = checkAdminPermission(adminEmail);
  if (!adminCheck.isAdmin) {
    return { success: false, error: '관리자 권한이 필요합니다.' };
  }

  if (!['admin', 'teacher'].includes(role)) {
    return { success: false, error: '올바른 역할을 선택해주세요.' };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      // 자신의 역할은 변경 불가
      if (email.toLowerCase() === adminEmail.toLowerCase() && role !== 'admin') {
        return { success: false, error: '자신의 관리자 권한은 해제할 수 없습니다.' };
      }

      sheet.getRange(i + 1, 4).setValue(role);
      return { success: true, message: `역할이 ${role === 'admin' ? '관리자' : '교사'}로 변경되었습니다.` };
    }
  }

  return { success: false, error: '교사를 찾을 수 없습니다.' };
}

/**
 * 교사 계정 삭제 (관리자 전용)
 * @param {string} email - 삭제할 교사 이메일
 * @param {string} adminEmail - 삭제하는 관리자 이메일
 * @returns {object} { success, error? }
 */
function deleteTeacherAccount(email, adminEmail) {
  const adminCheck = checkAdminPermission(adminEmail);
  if (!adminCheck.isAdmin) {
    return { success: false, error: '관리자 권한이 필요합니다.' };
  }

  // 자신 삭제 불가
  if (email.toLowerCase() === adminEmail.toLowerCase()) {
    return { success: false, error: '자신의 계정은 삭제할 수 없습니다.' };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      sheet.deleteRow(i + 1);
      return { success: true, message: '교사 계정이 삭제되었습니다.' };
    }
  }

  return { success: false, error: '교사를 찾을 수 없습니다.' };
}

/**
 * 이메일로 교사 정보 조회
 * @param {string} email - 교사 이메일
 * @returns {object} { success, teacher?, error? }
 */
function getTeacherByEmail(email) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  if (!sheet) {
    return { success: false, error: '교사 데이터를 찾을 수 없습니다.' };
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      return {
        success: true,
        teacher: {
          email: data[i][0],
          name: data[i][1],
          role: data[i][3],
          status: data[i][4],
          registeredAt: data[i][5],
          approvedAt: data[i][6],
          lastLogin: data[i][7]
        }
      };
    }
  }

  return { success: false, error: '교사를 찾을 수 없습니다.' };
}

// ============================================
// 다중 교사 헬퍼 함수
// ============================================

/**
 * 교사 비밀번호 해시 생성
 * @param {string} password - 원본 비밀번호
 * @returns {string} 해시값
 */
function hashTeacherPassword(password) {
  const settings = getSettings();
  const salt = settings.pinSalt || 'default-salt';
  const input = 'teacher-pw:' + password + ':' + salt;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return Utilities.base64Encode(hash);
}

/**
 * 교사 세션 저장 (이메일 포함)
 * @param {string} token - 세션 토큰
 * @param {string} email - 교사 이메일
 */
function saveTeacherSessionWithEmail(token, email) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 8); // 8시간 유효

  const sessionData = JSON.stringify({
    token: token,
    email: email,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString()
  });

  saveSettings({ teacherSession: sessionData });
}

/**
 * 관리자 권한 확인
 * @param {string} email - 확인할 이메일
 * @returns {object} { isAdmin, teacher? }
 */
function checkAdminPermission(email) {
  if (!email) {
    return { isAdmin: false };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.TEACHERS);
  if (!sheet) {
    return { isAdmin: false };
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
      return {
        isAdmin: data[i][3] === 'admin' && data[i][4] === 'approved',
        teacher: {
          email: data[i][0],
          name: data[i][1],
          role: data[i][3],
          status: data[i][4]
        }
      };
    }
  }

  return { isAdmin: false };
}

/**
 * 현재 세션의 관리자 여부 확인
 * @returns {object} { isAdmin, email? }
 */
function checkCurrentUserAdmin() {
  const settings = getSettings();
  const sessionData = settings.teacherSession;

  if (!sessionData) {
    return { isAdmin: false };
  }

  try {
    const session = JSON.parse(sessionData);
    if (new Date() > new Date(session.expiresAt)) {
      return { isAdmin: false };
    }

    return checkAdminPermission(session.email);
  } catch (e) {
    return { isAdmin: false };
  }
}

/**
 * 첫 관리자 초기화 (스프레드시트 소유자)
 * @param {Sheet} sheet - TEACHERS 시트
 */
function initializeFirstAdmin(sheet) {
  const data = sheet.getDataRange().getValues();

  // 이미 교사가 있으면 스킵
  if (data.length > 1) {
    return;
  }

  // 스프레드시트 소유자를 첫 관리자로 등록
  try {
    const ownerEmail = SpreadsheetApp.getActive().getOwner().getEmail();
    const now = new Date().toISOString();

    sheet.appendRow([
      ownerEmail,
      '관리자',
      '', // 비밀번호는 나중에 설정
      'admin',
      'approved',
      now,
      now,
      ''
    ]);
  } catch (e) {
    // 소유자 정보를 가져올 수 없는 경우 스킵
    console.log('첫 관리자 자동 등록 실패:', e.message);
  }
}

/**
 * 관리자 이름 조회 (TEACHERS 시트에서)
 * @returns {string} 관리자 이름 (없으면 빈 문자열)
 */
function getAdminName() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);

    if (!sheet) {
      return '';
    }

    const data = sheet.getDataRange().getValues();

    // 헤더 제외하고 admin 역할 찾기
    for (let i = 1; i < data.length; i++) {
      const role = data[i][3]; // 역할 컬럼
      const status = data[i][4]; // 상태 컬럼

      if (role === 'admin' && status === 'approved') {
        return data[i][1] || ''; // 이름 컬럼
      }
    }

    return '';
  } catch (e) {
    console.log('관리자 이름 조회 실패:', e.message);
    return '';
  }
}

/**
 * 관리자 이름 업데이트 (TEACHERS 시트에서)
 * @param {string} newName - 새 이름
 * @returns {boolean} 성공 여부
 */
function updateAdminName(newName) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);

    if (!sheet) {
      return false;
    }

    const data = sheet.getDataRange().getValues();

    // 헤더 제외하고 admin 역할 찾기
    for (let i = 1; i < data.length; i++) {
      const role = data[i][3]; // 역할 컬럼
      const status = data[i][4]; // 상태 컬럼

      if (role === 'admin' && status === 'approved') {
        // 이름 컬럼 업데이트 (2번째 컬럼, 1-indexed면 B)
        sheet.getRange(i + 1, 2).setValue(newName);
        return true;
      }
    }

    return false;
  } catch (e) {
    console.log('관리자 이름 업데이트 실패:', e.message);
    return false;
  }
}
