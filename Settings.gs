/**
 * 스토리 구성 웹학습지 - 설정 관리 함수
 *
 * @version 1.0.0
 */

// ============================================
// 설정 조회
// ============================================

/**
 * 모든 설정 조회
 * @returns {object} 설정 객체
 */
function getSettings() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.SETTINGS);

  if (!sheet) {
    return {
      systemMode: 'classroom',  // classroom 또는 personal
      teacherName: '',
      schoolName: '',
      className: '',
      welcomeMessage: '오늘도 멋진 이야기를 만들어볼까요? 🌟',
      theme: 'default',
      version: VERSION
    };
  }

  const data = sheet.getDataRange().getValues();
  const settings = {};

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const value = data[i][1];
    if (key) {
      settings[key] = value;
    }
  }

  return settings;
}

/**
 * 특정 설정값 조회
 * @param {string} key - 설정 키
 * @returns {*} 설정값
 */
function getSetting(key) {
  const settings = getSettings();
  return settings[key] || null;
}

// ============================================
// 설정 저장
// ============================================

/**
 * 설정 저장 (여러 개 한번에)
 * @param {object} newSettings - 저장할 설정 객체
 * @returns {object} { success, error? }
 */
function saveSettings(newSettings) {
  if (!newSettings || typeof newSettings !== 'object') {
    return { success: false, error: '설정 데이터가 올바르지 않습니다.' };
  }

  const sheet = getOrCreateSheet(SHEET_NAMES.SETTINGS);
  const data = sheet.getDataRange().getValues();

  // 기존 키 위치 찾기
  const keyRows = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      keyRows[data[i][0]] = i + 1;
    }
  }

  // 설정 업데이트
  for (const [key, value] of Object.entries(newSettings)) {
    // 보호된 키는 건너뛰기
    if (['pinSalt', 'createdAt'].includes(key)) {
      continue;
    }

    if (keyRows[key]) {
      // 기존 키 업데이트
      sheet.getRange(keyRows[key], 2).setValue(value);
    } else {
      // 새 키 추가
      sheet.appendRow([key, value]);
    }
  }

  return { success: true };
}

/**
 * 단일 설정 저장
 * @param {string} key - 설정 키
 * @param {*} value - 설정값
 * @returns {object} { success, error? }
 */
function saveSetting(key, value) {
  return saveSettings({ [key]: value });
}

// ============================================
// 초기 설정 마법사용
// ============================================

/**
 * 초기 설정 저장 (마법사 완료 시)
 * @param {object} setupData - 초기 설정 데이터
 * @returns {object} { success, error? }
 */
function completeInitialSetup(setupData) {
  const { teacherName, schoolName, className, welcomeMessage } = setupData;

  // 필수 입력 확인
  if (!teacherName || teacherName.trim() === '') {
    return { success: false, error: '선생님 성함을 입력해주세요.' };
  }

  // 설정 저장
  const result = saveSettings({
    teacherName: teacherName.trim(),
    schoolName: (schoolName || '').trim(),
    className: (className || '').trim(),
    welcomeMessage: welcomeMessage || '오늘도 멋진 이야기를 만들어볼까요! 🌟',
    setupCompletedAt: new Date().toISOString()
  });

  return result;
}

// ============================================
// 버전 관리
// ============================================

/**
 * 버전 체크 (GitHub에서 최신 버전 확인)
 * @returns {object} { currentVersion, latestVersion?, updateAvailable?, error? }
 */
function checkVersion() {
  const currentVersion = VERSION;

  try {
    // GitHub raw URL에서 version.json 가져오기
    // 실제 배포 시 이 URL을 업데이트해야 함
    const versionUrl = 'https://raw.githubusercontent.com/story-creator/story-worksheet/main/version.json';

    const response = UrlFetchApp.fetch(versionUrl, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      return {
        success: true,
        currentVersion: currentVersion,
        latestVersion: null,
        updateAvailable: false
      };
    }

    const versionData = JSON.parse(response.getContentText());

    return {
      success: true,
      currentVersion: currentVersion,
      latestVersion: versionData.version,
      updateAvailable: compareVersions(versionData.version, currentVersion) > 0,
      critical: versionData.critical || false,
      changelog: versionData.changelog || '',
      downloadUrl: versionData.downloadUrl || ''
    };

  } catch (error) {
    return {
      success: true,
      currentVersion: currentVersion,
      latestVersion: null,
      updateAvailable: false,
      error: '버전 확인 실패'
    };
  }
}

/**
 * 버전 비교
 * @param {string} v1 - 버전 1
 * @param {string} v2 - 버전 2
 * @returns {number} v1 > v2이면 1, v1 < v2이면 -1, 같으면 0
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

// ============================================
// 테마 관리
// ============================================

/**
 * 테마 설정
 * @param {string} theme - 테마 이름
 * @returns {object} { success, error? }
 */
function setTheme(theme) {
  const validThemes = ['default', 'dark', 'colorful', 'minimal'];

  if (!validThemes.includes(theme)) {
    return { success: false, error: '올바른 테마를 선택해주세요.' };
  }

  return saveSetting('theme', theme);
}

/**
 * 현재 테마 가져오기
 * @returns {string} 테마 이름
 */
function getTheme() {
  return getSetting('theme') || 'default';
}

// ============================================
// 데이터 검증
// ============================================

/**
 * 스프레드시트 데이터 무결성 검증
 * @returns {object} { success, warnings[], errors[] }
 */
function validateAllData() {
  const warnings = [];
  const errors = [];

  // 1. 시트 존재 확인
  const ss = SpreadsheetApp.getActive();
  const requiredSheets = [
    SHEET_NAMES.STUDENTS,
    SHEET_NAMES.WORKS_STEP1,
    SHEET_NAMES.WORKS_STEP2,
    SHEET_NAMES.WORKS_STEP3,
    SHEET_NAMES.SETTINGS
  ];

  for (const sheetName of requiredSheets) {
    if (!ss.getSheetByName(sheetName)) {
      errors.push(`시트 "${sheetName}"가 없습니다.`);
    }
  }

  // 2. STUDENTS 데이터 검증
  const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
  if (studentsSheet) {
    const data = studentsSheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 1;

      // 이름 검사
      if (!row[0]) {
        errors.push(`STUDENTS ${rowNum}행: 이름이 비어있습니다.`);
      }

      // 번호 검사
      const num = row[1];
      if (num === '' || num === null) {
        errors.push(`STUDENTS ${rowNum}행: 번호가 비어있습니다.`);
      } else if (num < 1 || num > 100) {
        warnings.push(`STUDENTS ${rowNum}행: 번호가 1~100 범위를 벗어났습니다 (${num}).`);
      }

      // 상태 검사
      const status = row[6];
      if (!['pending', 'active', 'inactive'].includes(status)) {
        warnings.push(`STUDENTS ${rowNum}행: 상태 값이 올바르지 않습니다 (${status}).`);
      }
    }
  }

  // 3. SETTINGS 검증
  const settings = getSettings();
  if (!settings.pinSalt) {
    errors.push('SETTINGS: pinSalt가 설정되지 않았습니다.');
  }

  return {
    success: errors.length === 0,
    warnings: warnings,
    errors: errors
  };
}

// ============================================
// 백업/복원
// ============================================

/**
 * 전체 데이터 JSON으로 백업
 * @returns {object} { success, data?, error? }
 */
function backupAllData() {
  try {
    const backup = {
      exportedAt: new Date().toISOString(),
      version: VERSION,
      settings: getSettings(),
      students: getAllStudents().data || [],
      works: {
        step1: getAllWorks(1).data || [],
        step2: getAllWorks(2).data || [],
        step3: getAllWorks(3).data || []
      }
    };

    return { success: true, data: backup };

  } catch (error) {
    return { success: false, error: '백업 실패: ' + error.message };
  }
}
