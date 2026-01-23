/**
 * 스토리 구성 웹학습지 - 메인 코드
 * 점조직 모델: 각 교사가 독립된 시스템 운영
 *
 * @version 1.0.0
 * @author Story Creator Team
 */

// ============================================
// 전역 상수
// ============================================
const VERSION = "1.0.0";

const SHEET_NAMES = {
  STUDENTS: "STUDENTS",
  WORKS_STEP1: "WORKS_STEP1",
  WORKS_STEP2: "WORKS_STEP2",
  WORKS_STEP3: "WORKS_STEP3",
  SETTINGS: "SETTINGS",
  TEACHERS: "TEACHERS",
  AI_SESSIONS: "AI_SESSIONS",
  AI_USAGE: "AI_USAGE",
};

const STUDENT_HEADERS = [
  "이름",
  "번호",
  "PIN해시",
  "토큰",
  "등록일",
  "마지막접속",
  "상태",
];
const WORK_HEADERS = [
  "학생이름",
  "학생번호",
  "작품데이터",
  "생성일",
  "수정일",
  "완료여부",
  "상태",
];
const SETTINGS_HEADERS = ["키", "값"];
const TEACHER_HEADERS = [
  "이메일",
  "이름",
  "비밀번호해시",
  "역할",
  "상태",
  "등록일",
  "승인일",
  "마지막접속",
];

// ============================================
// 웹앱 엔트리 포인트
// ============================================

/**
 * GET 요청 처리 - 웹앱 메인 진입점
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile("Index");

  // URL 파라미터 전달
  template.params = e ? e.parameter : {};

  return template
    .evaluate()
    .setTitle("스토리 구성 웹학습지")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0");
}

/**
 * POST 요청 처리 - API 엔드포인트
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // 관리자 권한이 필요한 작업 목록
    const ADMIN_ACTIONS = [
      "registerStudent",
      "importStudents",
      "getStudents",
      "resetPin",
      "regenerateToken",
      "updateStudentStatus",
      "deleteStudent",
      "saveSettings",
      "saveAiSettings",
      "getAiSettings",
      "getApiKeyInfo",
      "initialize",
      "getAllWorks",
      "approveTeacher",
      "rejectTeacher",
      "getAllTeachers",
      "updateTeacherRole",
      "deleteTeacher",
      "addTeacherByAdmin",
    ];

    // 관리자 권한 체크
    if (ADMIN_ACTIONS.includes(action)) {
      const authResult = isTeacherAuthorized(data.teacherToken);
      if (!authResult.isAuthorized) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            error: "권한이 없습니다. (Unauthorized)",
            code: "UNAUTHORIZED",
          }),
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    let result;

    switch (action) {
      // 학생 인증 관련
      case "login":
        result = loginStudent(data.name, data.number, data.pin);
        break;
      case "loginByToken":
        result = loginStudentByToken(data.token);
        break;
      case "setPin":
        result = setStudentPin(data.name, data.number, data.pin);
        break;
      case "checkStudent":
        result = checkStudentStatus(data.name, data.number);
        break;

      // 교사 인증 관련
      case "loginTeacher":
        result = loginTeacher(data.pin);
        break;
      case "setTeacherPin":
        result = setTeacherPin(data.pin, data.currentPin);
        break;
      case "verifyTeacherSession":
        result = verifyTeacherSession(data.teacherToken);
        break;
      case "checkTeacherAuth":
        result = isTeacherAuthorized(data.teacherToken);
        break;
      case "checkGoogleAuth":
        result = checkGoogleAuth();
        break;
      case "logoutTeacher":
        result = logoutTeacher();
        break;
      case "hasTeacherPin":
        result = hasTeacherPin();
        break;

      // 교사 관리 (다중 교사 시스템)
      case "registerTeacher":
        result = registerTeacher(data.email, data.name, data.password);
        break;
      case "loginTeacherWithEmail":
        result = loginTeacherWithEmail(data.email, data.password);
        break;
      case "loginTeacherWithGoogle":
        result = loginTeacherWithGoogle();
        break;
      // checkGoogleAuth는 위(87-89행)에서 이미 처리됨
      case "approveTeacher":
        result = approveTeacher(data.email, data.adminEmail);
        break;
      case "rejectTeacher":
        result = rejectTeacher(data.email, data.reason);
        break;
      case "getAllTeachers":
        result = getAllTeachers();
        break;
      case "updateTeacherRole":
        result = updateTeacherRole(data.email, data.role, data.adminEmail);
        break;
      case "deleteTeacher":
        result = deleteTeacherAccount(data.email, data.adminEmail);
        break;
      case "getTeacherByEmail":
        result = getTeacherByEmail(data.email);
        break;
      case "addTeacherByAdmin":
        result = addTeacherByAdmin(
          data.email,
          data.name,
          data.role,
          data.adminEmail,
        );
        break;

      // 학생 관리 (교사용)
      case "registerStudent":
        result = registerStudentByTeacher(data.name, data.number, data.pin);
        break;
      case "importStudents":
        result = importStudents(data.csvData, data.pinMode);
        break;
      case "getStudents":
        result = getAllStudents();
        break;
      case "resetPin":
        result = resetStudentPin(data.name, data.number, data.newPin);
        break;
      case "regenerateToken":
        result = regenerateToken(data.name, data.number);
        break;
      case "updateStudentStatus":
        result = updateStudentStatus(data.name, data.number, data.status);
        break;
      case "deleteStudent":
        result = deleteStudent(data.name, data.number);
        break;

      // 작품 관련
      case "saveWork":
        result = saveWork(
          data.studentName,
          data.studentNumber,
          data.step,
          data.workData,
        );
        break;
      case "getWork":
        result = getWork(data.studentName, data.studentNumber, data.step);
        break;
      case "getStudentWorks":
        result = getStudentWorks(data.studentName, data.studentNumber);
        break;
      case "getAllWorks":
        result = getAllWorks(data.step);
        break;
      case "exportWork":
        result = exportWorkAsJson(
          data.studentName,
          data.studentNumber,
          data.step,
        );
        break;

      // 개인 모드 작품 관련
      case "getPersonalWorks":
        result = getPersonalWorks();
        break;
      case "savePersonalWork":
        result = savePersonalWork(data.workId, data.workData);
        break;
      case "getPersonalWork":
        result = getPersonalWork(data.workId);
        break;
      case "exportAllWorks":
        result = exportAllWorksAsJson(data.format);
        break;

      // 설정 관련
      case "getSettings":
        result = getSettings();
        break;
      case "saveSettings":
        // teacherName이 포함되어 있으면 TEACHERS 시트도 업데이트
        if (data.settings && data.settings.teacherName) {
          updateAdminName(data.settings.teacherName);
        }
        result = saveSettings(data.settings);
        break;
      case "isFirstSetup":
        result = isFirstSetup();
        break;
      case "getAdminName":
        result = { success: true, name: getAdminName() };
        break;

      // 시스템 관련
      case "initialize":
        result = initializeSpreadsheet();
        break;
      case "getSystemInfo":
        result = getSystemInfo();
        break;
      case "checkVersion":
        result = checkVersion();
        break;

      // 또리 AI 관련
      case "createTtoriSession":
        result = createTtoriSession(
          data.studentName,
          data.studentNumber,
          data.step,
        );
        break;
      case "getTtoriSessions":
        result = getTtoriSessions(
          data.studentName,
          data.studentNumber,
          data.step,
        );
        break;
      case "loadTtoriSession":
        result = loadTtoriSession(data.sessionId);
        break;
      case "deleteTtoriSession":
        result = deleteTtoriSession(data.sessionId);
        break;
      case "sendMessageToTtori":
        result = sendMessageToTtori(
          data.sessionId,
          data.message,
          data.workContext,
        );
        break;
      case "getAiSettings":
        result = { success: true, data: getAiSettings() };
        break;
      case "saveAiSettings":
        result = saveAiSettings(data.settings);
        break;
      case "testAiApiKey":
        result = testAiApiKey(data.apiKey);
        break;
      case "getAiUsageStats":
        result = getAiUsageStats();
        break;
      case "checkAiEnabled":
        const aiSettings = getAiSettings();
        result = {
          success: true,
          enabled: aiSettings.aiEnabled,
          hasApiKey: !!aiSettings.aiApiKey,
        };
        break;
      case "getDrawingHint":
        result = getDrawingHint(
          data.sceneDescription,
          data.sceneDialogue,
          data.stageName,
        );
        break;
      case "exportStoryboardPDF":
        result = exportStoryboardPDF(
          data.studentName,
          data.studentNumber,
          data.title,
          data.scenes,
          data.sceneImages,
        );
        break;
      case "exportDrawingGuidePDF":
        result = exportDrawingGuidePDF(
          data.sceneName,
          data.sceneDescription,
          data.hints,
          data.userAdditions,
          data.editedItems,
          data.studentName,
          data.title,
        );
        break;

      // API 키 보안 관련 (Script Properties 기반)
      case "getApiKeyInfo":
        result = {
          success: true,
          hasKey: hasSecureApiKey(),
          maskedKey: getMaskedApiKey(),
        };
        break;

      default:
        result = { success: false, error: "알 수 없는 요청입니다." };
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON,
    );
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: "서버 오류가 발생했습니다: " + error.message,
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * HTML 파일 include 헬퍼
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 클라이언트에서 서버 함수 호출용 래퍼
 */
function callApi(action, data) {
  const payload = Object.assign({ action: action }, data || {});

  // doPost와 동일한 로직 실행
  const e = { postData: { contents: JSON.stringify(payload) } };
  const response = doPost(e);
  return JSON.parse(response.getContent());
}

// ============================================
// 시스템 초기화
// ============================================

/**
 * 스프레드시트 초기화 (첫 설치 시)
 */
function initializeSpreadsheet() {
  const ss = SpreadsheetApp.getActive();

  try {
    // 1. STUDENTS 시트
    let studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    if (!studentsSheet) {
      studentsSheet = ss.insertSheet(SHEET_NAMES.STUDENTS);
    }
    setupSheet(studentsSheet, STUDENT_HEADERS);

    // 2. WORKS_STEP1 시트
    let works1Sheet = ss.getSheetByName(SHEET_NAMES.WORKS_STEP1);
    if (!works1Sheet) {
      works1Sheet = ss.insertSheet(SHEET_NAMES.WORKS_STEP1);
    }
    setupSheet(works1Sheet, WORK_HEADERS);

    // 3. WORKS_STEP2 시트
    let works2Sheet = ss.getSheetByName(SHEET_NAMES.WORKS_STEP2);
    if (!works2Sheet) {
      works2Sheet = ss.insertSheet(SHEET_NAMES.WORKS_STEP2);
    }
    setupSheet(works2Sheet, WORK_HEADERS);

    // 4. WORKS_STEP3 시트
    let works3Sheet = ss.getSheetByName(SHEET_NAMES.WORKS_STEP3);
    if (!works3Sheet) {
      works3Sheet = ss.insertSheet(SHEET_NAMES.WORKS_STEP3);
    }
    setupSheet(works3Sheet, WORK_HEADERS);

    // 5. SETTINGS 시트
    let settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
    }
    setupSheet(settingsSheet, SETTINGS_HEADERS);

    // 6. TEACHERS 시트
    let teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    if (!teachersSheet) {
      teachersSheet = ss.insertSheet(SHEET_NAMES.TEACHERS);
    }
    setupSheet(teachersSheet, TEACHER_HEADERS);

    // 7. AI_SESSIONS 시트 (또리 AI용)
    initializeAiSessionsSheet();

    // 기본 설정값 저장
    initializeSettings(settingsSheet);

    // 첫 관리자 설정 (스프레드시트 소유자)
    initializeFirstAdmin(teachersSheet);

    // 기본 Sheet1 삭제 (있다면)
    const defaultSheet =
      ss.getSheetByName("Sheet1") || ss.getSheetByName("시트1");
    if (defaultSheet && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }

    return { success: true, message: "시스템이 초기화되었습니다." };
  } catch (error) {
    return { success: false, error: "초기화 실패: " + error.message };
  }
}

/**
 * 시트 설정 (헤더, 서식)
 */
function setupSheet(sheet, headers) {
  // 헤더가 없으면 추가
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = currentHeaders.some((h) => h !== "");

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // 헤더 서식
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#4A90D9");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");

  // 헤더 행 고정
  sheet.setFrozenRows(1);

  // 컬럼 너비 자동 조정
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

/**
 * 기본 설정값 초기화
 */
function initializeSettings(sheet) {
  const existingData = sheet.getDataRange().getValues();
  const existingKeys = existingData.slice(1).map((row) => row[0]);

  const defaultSettings = {
    pinSalt: Utilities.getUuid(),
    version: VERSION,
    createdAt: new Date().toISOString(),
    teacherName: "",
    schoolName: "",
    className: "",
    welcomeMessage: "오늘도 멋진 이야기를 만들어볼까요? 🌟",
    theme: "default",
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!existingKeys.includes(key)) {
      sheet.appendRow([key, value]);
    }
  }
}

/**
 * 시스템 정보 반환
 */
function getSystemInfo() {
  const settings = getSettings();
  const students = getAllStudents();
  const adminName = getAdminName(); // TEACHERS 시트에서 관리자 이름 조회

  const activeCount = students.data
    ? students.data.filter((s) => s.status === "active").length
    : 0;
  const pendingCount = students.data
    ? students.data.filter((s) => s.status === "pending").length
    : 0;

  return {
    success: true,
    version: VERSION,
    teacherName: adminName, // TEACHERS 시트의 admin 이름 사용
    schoolName: settings.schoolName || "",
    className: settings.className || "",
    totalStudents: students.data ? students.data.length : 0,
    activeStudents: activeCount,
    pendingStudents: pendingCount,
    webAppUrl: ScriptApp.getService().getUrl(),
  };
}

/**
 * 첫 설정인지 확인
 */
function isFirstSetup() {
  const adminName = getAdminName(); // TEACHERS 시트에서 관리자 이름 조회
  return {
    success: true,
    isFirstSetup: !adminName || adminName === "" || adminName === "관리자", // 기본값 '관리자'도 미설정으로 간주
  };
}

/**
 * 교사 PIN 설정 여부 확인
 */
function hasTeacherPin() {
  const settings = getSettings();
  return {
    success: true,
    hasPin: !!settings.teacherPinHash,
  };
}
