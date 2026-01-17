/**
 * 스토리 구성 웹학습지 - 유틸리티 함수
 *
 * @version 1.1.0
 */

// ============================================
// 캐시 시스템 (N+1 쿼리 문제 해결)
// ============================================

/**
 * 스크립트 실행 중 데이터 캐시
 * GAS는 요청마다 새로 실행되므로 메모리 캐시는 단일 요청 내에서만 유효
 */
const DataCache = {
  _students: null,
  _studentsByToken: null,
  _works: {},  // step별 캐시: { 1: [...], 2: [...], 3: [...] }
  _settings: null,
  _cacheTime: null,

  /**
   * 캐시 초기화
   */
  clear: function() {
    this._students = null;
    this._studentsByToken = null;
    this._works = {};
    this._settings = null;
    this._cacheTime = null;
  },

  /**
   * 모든 학생 데이터 캐시 로드 (N+1 문제 해결)
   * @returns {Array} 학생 배열
   */
  getStudents: function() {
    if (this._students === null) {
      const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.STUDENTS);
      if (!sheet) {
        this._students = [];
        this._studentsByToken = {};
        return this._students;
      }

      const data = sheet.getDataRange().getValues();
      this._students = [];
      this._studentsByToken = {};

      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          const student = {
            row: i + 1,
            name: data[i][0],
            number: data[i][1],
            pinHash: data[i][2],
            token: data[i][3],
            createdAt: data[i][4],
            lastAccessAt: data[i][5],
            status: data[i][6]
          };
          this._students.push(student);
          if (student.token) {
            this._studentsByToken[student.token] = student;
          }
        }
      }
      this._cacheTime = new Date();
    }
    return this._students;
  },

  /**
   * 이름+번호로 학생 찾기 (캐시 사용)
   * @param {string} name
   * @param {number} number
   * @returns {object|null}
   */
  findStudent: function(name, number) {
    const students = this.getStudents();
    return students.find(s => s.name === name && s.number === number) || null;
  },

  /**
   * 토큰으로 학생 찾기 (캐시 사용)
   * @param {string} token
   * @returns {object|null}
   */
  findStudentByToken: function(token) {
    this.getStudents(); // 캐시 로드
    return this._studentsByToken[token] || null;
  },

  /**
   * 특정 단계의 모든 작품 캐시 로드
   * @param {number} step
   * @returns {Array}
   */
  getWorks: function(step) {
    if (!this._works[step]) {
      const sheetName = getWorkSheetName(step);
      const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

      if (!sheet) {
        this._works[step] = [];
        return this._works[step];
      }

      const data = sheet.getDataRange().getValues();
      this._works[step] = [];

      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          this._works[step].push({
            row: i + 1,
            studentName: data[i][0],
            studentNumber: data[i][1],
            workDataRaw: data[i][2],  // 지연 파싱을 위해 raw 저장
            createdAt: data[i][3],
            updatedAt: data[i][4],
            isComplete: data[i][5] === true || data[i][5] === 'TRUE',
            status: data[i][6]
          });
        }
      }
    }
    return this._works[step];
  },

  /**
   * 특정 학생의 작품 찾기 (캐시 사용)
   * @param {string} studentName
   * @param {number} studentNumber
   * @param {number} step
   * @returns {object|null}
   */
  findWork: function(studentName, studentNumber, step) {
    const works = this.getWorks(step);
    const work = works.find(w => w.studentName === studentName && w.studentNumber === studentNumber);

    if (work && !work.workData && work.workDataRaw) {
      // 지연 파싱
      work.workData = safeJsonParse(work.workDataRaw);
    }

    return work || null;
  },

  /**
   * 작품 캐시 무효화 (저장/삭제 후 호출)
   * @param {number} step
   */
  invalidateWorks: function(step) {
    if (step) {
      delete this._works[step];
    } else {
      this._works = {};
    }
  },

  /**
   * 학생 캐시 무효화
   */
  invalidateStudents: function() {
    this._students = null;
    this._studentsByToken = null;
  }
};

// ============================================
// Rate Limiting (무차별 대입 공격 방어)
// ============================================

/**
 * Rate Limiter 설정
 */
const RateLimiter = {
  // 설정값
  MAX_ATTEMPTS: 5,           // 최대 시도 횟수
  WINDOW_MINUTES: 15,        // 시간 윈도우 (분)
  LOCKOUT_MINUTES: 30,       // 잠금 시간 (분)

  /**
   * 시도 기록 확인 및 차단 여부 반환
   * @param {string} identifier - 식별자 (IP 또는 이름+번호)
   * @param {string} action - 액션 타입 (login, pin_setup 등)
   * @returns {object} { allowed: boolean, remaining?: number, retryAfter?: number }
   */
  checkLimit: function(identifier, action) {
    const cacheKey = `rate_${action}_${identifier}`;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);

    if (!cached) {
      return { allowed: true, remaining: this.MAX_ATTEMPTS - 1 };
    }

    try {
      const data = JSON.parse(cached);
      const now = Date.now();

      // 잠금 상태 확인
      if (data.lockedUntil && now < data.lockedUntil) {
        const retryAfter = Math.ceil((data.lockedUntil - now) / 60000);
        return {
          allowed: false,
          remaining: 0,
          retryAfter: retryAfter,
          message: `너무 많은 시도입니다. ${retryAfter}분 후에 다시 시도해주세요.`
        };
      }

      // 윈도우 내 시도 횟수 확인
      const windowStart = now - (this.WINDOW_MINUTES * 60 * 1000);
      const recentAttempts = (data.attempts || []).filter(t => t > windowStart);

      if (recentAttempts.length >= this.MAX_ATTEMPTS) {
        // 잠금 설정
        data.lockedUntil = now + (this.LOCKOUT_MINUTES * 60 * 1000);
        data.attempts = recentAttempts;
        cache.put(cacheKey, JSON.stringify(data), this.LOCKOUT_MINUTES * 60 + 60);

        return {
          allowed: false,
          remaining: 0,
          retryAfter: this.LOCKOUT_MINUTES,
          message: `너무 많은 시도입니다. ${this.LOCKOUT_MINUTES}분 후에 다시 시도해주세요.`
        };
      }

      return { allowed: true, remaining: this.MAX_ATTEMPTS - recentAttempts.length - 1 };

    } catch (e) {
      return { allowed: true, remaining: this.MAX_ATTEMPTS - 1 };
    }
  },

  /**
   * 실패한 시도 기록
   * @param {string} identifier
   * @param {string} action
   */
  recordAttempt: function(identifier, action) {
    const cacheKey = `rate_${action}_${identifier}`;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);

    let data = { attempts: [] };
    if (cached) {
      try {
        data = JSON.parse(cached);
      } catch (e) {
        data = { attempts: [] };
      }
    }

    const now = Date.now();
    const windowStart = now - (this.WINDOW_MINUTES * 60 * 1000);

    // 오래된 시도 제거하고 새 시도 추가
    data.attempts = (data.attempts || []).filter(t => t > windowStart);
    data.attempts.push(now);

    cache.put(cacheKey, JSON.stringify(data), (this.WINDOW_MINUTES + 5) * 60);
  },

  /**
   * 성공 시 기록 초기화
   * @param {string} identifier
   * @param {string} action
   */
  resetAttempts: function(identifier, action) {
    const cacheKey = `rate_${action}_${identifier}`;
    const cache = CacheService.getScriptCache();
    cache.remove(cacheKey);
  }
};

// ============================================
// PIN 해시 관련
// ============================================

/**
 * PIN을 SHA-256으로 해시
 * @param {string} pin - 6자리 PIN
 * @returns {string} Base64 인코딩된 해시값
 */
function hashPin(pin) {
  const salt = getSalt();
  const combined = salt + pin;

  const rawHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    combined,
    Utilities.Charset.UTF_8
  );

  // Byte array를 Base64로 변환
  const base64Hash = Utilities.base64Encode(rawHash);
  return base64Hash;
}

/**
 * Salt 가져오기 (없으면 생성)
 * @returns {string} Salt 값
 */
function getSalt() {
  const ss = SpreadsheetApp.getActive();
  const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);

  if (!settingsSheet) {
    // SETTINGS 시트가 없으면 생성
    const newSheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
    setupSheet(newSheet, SETTINGS_HEADERS);
    const newSalt = Utilities.getUuid();
    newSheet.appendRow(['pinSalt', newSalt]);
    return newSalt;
  }

  const data = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'pinSalt') {
      return data[i][1];
    }
  }

  // Salt가 없으면 생성
  const newSalt = Utilities.getUuid();
  settingsSheet.appendRow(['pinSalt', newSalt]);
  return newSalt;
}

// ============================================
// 토큰 생성
// ============================================

/**
 * 학생용 QR 토큰 생성
 * @returns {string} "tk_" + 12자리 UUID
 */
function generateToken() {
  return 'tk_' + Utilities.getUuid().substring(0, 12).replace(/-/g, '');
}

// ============================================
// 날짜 포맷팅
// ============================================

/**
 * 날짜를 한국 형식으로 포맷
 * @param {Date} date - 날짜 객체
 * @returns {string} "YYYY-MM-DD HH:mm" 형식
 */
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  if (isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 날짜를 짧은 형식으로 포맷
 * @param {Date} date - 날짜 객체
 * @returns {string} "YYYY-MM-DD" 형식
 */
function formatDateShort(date) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  if (isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * 상대 시간 표시 (예: "3일 전")
 * @param {Date} date - 날짜 객체
 * @returns {string} 상대 시간 문자열
 */
function getRelativeTime(date) {
  if (!date) return '없음';
  if (typeof date === 'string') date = new Date(date);
  if (isNaN(date.getTime())) return '없음';

  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

// ============================================
// 입력값 검증
// ============================================

/**
 * 이름 유효성 검사
 * @param {string} name - 학생 이름
 * @returns {object} { valid: boolean, error?: string }
 */
function validateName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: '이름을 입력해주세요.' };
  }

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: '이름은 2글자 이상이어야 합니다.' };
  }
  if (trimmed.length > 20) {
    return { valid: false, error: '이름은 20글자 이하여야 합니다.' };
  }

  return { valid: true, value: trimmed };
}

/**
 * 번호 유효성 검사
 * @param {number|string} number - 학생 번호
 * @returns {object} { valid: boolean, error?: string }
 */
function validateNumber(number) {
  const num = parseInt(number, 10);

  if (isNaN(num)) {
    return { valid: false, error: '번호를 입력해주세요.' };
  }
  if (num < 1 || num > 100) {
    return { valid: false, error: '번호는 1~100 사이여야 합니다.' };
  }

  return { valid: true, value: num };
}

/**
 * PIN 유효성 검사
 * @param {string} pin - 6자리 PIN
 * @returns {object} { valid: boolean, error?: string }
 */
function validatePin(pin) {
  if (!pin || typeof pin !== 'string') {
    return { valid: false, error: 'PIN을 입력해주세요.' };
  }

  const trimmed = pin.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { valid: false, error: 'PIN은 숫자 6자리여야 합니다.' };
  }

  return { valid: true, value: trimmed };
}

// ============================================
// 데이터 변환
// ============================================

/**
 * 학생 행 데이터를 객체로 변환
 * @param {Array} row - 스프레드시트 행 데이터
 * @param {number} rowIndex - 행 번호 (1-based)
 * @returns {object} 학생 객체
 */
function rowToStudent(row, rowIndex) {
  return {
    row: rowIndex,
    name: row[0],
    number: row[1],
    pinHash: row[2],
    token: row[3],
    createdAt: row[4],
    lastAccessAt: row[5],
    status: row[6]
  };
}

/**
 * 작품 행 데이터를 객체로 변환
 * @param {Array} row - 스프레드시트 행 데이터
 * @param {number} rowIndex - 행 번호 (1-based)
 * @returns {object} 작품 객체
 */
function rowToWork(row, rowIndex) {
  let workData = null;
  try {
    workData = row[2] ? JSON.parse(row[2]) : null;
  } catch (e) {
    workData = null;
  }

  return {
    row: rowIndex,
    studentName: row[0],
    studentNumber: row[1],
    workData: workData,
    createdAt: row[3],
    updatedAt: row[4],
    isComplete: row[5] === true || row[5] === 'TRUE',
    status: row[6]
  };
}

// ============================================
// 시트 유틸리티
// ============================================

/**
 * 시트 가져오기 (없으면 생성)
 * @param {string} sheetName - 시트 이름
 * @returns {Sheet} 시트 객체
 */
function getOrCreateSheet(sheetName) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    // 시트 종류에 따라 헤더 설정
    if (sheetName === SHEET_NAMES.STUDENTS) {
      setupSheet(sheet, STUDENT_HEADERS);
    } else if (sheetName.startsWith('WORKS_')) {
      setupSheet(sheet, WORK_HEADERS);
    } else if (sheetName === SHEET_NAMES.SETTINGS) {
      setupSheet(sheet, SETTINGS_HEADERS);
    }
  }

  return sheet;
}

/**
 * 단계별 작품 시트 이름 가져오기
 * @param {number} step - 단계 (1, 2, 3)
 * @returns {string} 시트 이름
 */
function getWorkSheetName(step) {
  switch (parseInt(step)) {
    case 1: return SHEET_NAMES.WORKS_STEP1;
    case 2: return SHEET_NAMES.WORKS_STEP2;
    case 3: return SHEET_NAMES.WORKS_STEP3;
    default: return SHEET_NAMES.WORKS_STEP1;
  }
}

// ============================================
// JSON 유틸리티
// ============================================

/**
 * 안전하게 JSON 파싱
 * @param {string} jsonString - JSON 문자열
 * @param {*} defaultValue - 파싱 실패 시 기본값
 * @returns {*} 파싱된 객체 또는 기본값
 */
function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 안전하게 JSON 문자열화
 * @param {*} obj - 변환할 객체
 * @param {string} defaultValue - 변환 실패 시 기본값
 * @returns {string} JSON 문자열
 */
function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return defaultValue;
  }
}
