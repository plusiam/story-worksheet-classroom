/**
 * 또리 AI 도우미 - Gemini API 연동
 *
 * @version 1.0.0
 * @description 스토리 작성을 돕는 AI 채팅 기능
 */

// ============================================
// 상수 정의
// ============================================
const AI_SESSIONS_SHEET = 'AI_SESSIONS';
const AI_SESSIONS_HEADERS = ['세션ID', '학생이름', '학생번호', '작품단계', '세션제목', '대화기록', '메시지수', '생성일', '수정일'];
const AI_USAGE_SHEET = 'AI_USAGE';
const AI_USAGE_HEADERS = ['날짜', '학생이름', '학생번호', '사용횟수'];

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const DEFAULT_AI_SETTINGS = {
  aiEnabled: false,
  aiApiKey: '',
  dailyLimitPerStudent: 10,
  maxMessagesPerSession: 20,
  maxSessionsPerWork: 3,
  allowedHours: 'always' // 'always' | 'school' (09:00-15:00)
};

// ============================================
// 또리 시스템 프롬프트
// ============================================
const TTORI_SYSTEM_PROMPT = `# 또리 - 스토리 구성 AI 도우미

## 역할
너는 "또리"야. 초등학생이 4컷 스토리(기-승-전-결)를 만들 때 도와주는 친절한 AI 도우미야.

## 성격
- 밝고 친근한 말투 (반말 OK, 이모지 적절히 사용)
- 칭찬을 많이 해줘
- 어려운 단어는 쉽게 풀어서 설명해
- 학생의 아이디어를 존중하고 발전시켜줘

## 대화 방식
1. 먼저 학생이 쓴 내용을 칭찬해줘
2. 막힌 부분이 있으면 선택지(A/B/C)를 제안해줘
3. 한 번에 너무 많은 정보를 주지 마
4. 학생이 선택하면 그 방향으로 더 구체화해줘

## 4컷 스토리 구조 (기-승-전-결)
- 기(起): 이야기의 시작, 주인공과 배경 소개
- 승(承): 사건 발생, 문제나 갈등 시작
- 전(轉): 클라이맥스, 반전이나 중요한 변화
- 결(結): 마무리, 문제 해결이나 교훈

## 제안 형식
학생에게 선택지를 줄 때는 다음 형식을 사용해:

**A)** 첫 번째 선택지
**B)** 두 번째 선택지
**C)** 직접 입력하기

## 주의사항
- 절대 폭력적이거나 무서운 내용 제안하지 마
- 학생이 직접 생각할 수 있도록 힌트만 줘
- 대답은 짧고 명확하게 (3-4문장 이내)
- 학생의 아이디어가 더 중요해, 네 생각을 강요하지 마`;

// ============================================
// AI 세션 관리
// ============================================

/**
 * AI_SESSIONS 시트 초기화
 */
function initializeAiSessionsSheet() {
  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName(AI_SESSIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AI_SESSIONS_SHEET);
    setupSheet(sheet, AI_SESSIONS_HEADERS);
  }

  let usageSheet = ss.getSheetByName(AI_USAGE_SHEET);
  if (!usageSheet) {
    usageSheet = ss.insertSheet(AI_USAGE_SHEET);
    setupSheet(usageSheet, AI_USAGE_HEADERS);
  }

  return { success: true };
}

/**
 * 새 AI 세션 생성
 */
function createTtoriSession(studentName, studentNumber, step) {
  try {
    // AI 활성화 확인
    const aiSettings = getAiSettings();
    if (!aiSettings.aiEnabled) {
      return { success: false, error: 'AI 기능이 비활성화되어 있습니다.' };
    }

    // 일일 사용량 체크
    const limitCheck = checkDailyLimit(studentName, studentNumber);
    if (!limitCheck.allowed) {
      return {
        success: false,
        error: `오늘은 또리와 ${limitCheck.used}번 대화했어요! 내일 다시 만나요~ 🌟`,
        limitReached: true,
        used: limitCheck.used,
        limit: limitCheck.limit
      };
    }

    // 기존 세션 개수 확인 (작품당 최대 3개)
    const existingSessions = getTtoriSessions(studentName, studentNumber, step);
    if (existingSessions.data && existingSessions.data.length >= aiSettings.maxSessionsPerWork) {
      // 가장 오래된 세션 삭제
      const oldestSession = existingSessions.data[existingSessions.data.length - 1];
      deleteTtoriSession(oldestSession.sessionId);
    }

    const sessionId = Utilities.getUuid();
    const now = new Date().toISOString();

    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(AI_SESSIONS_SHEET);

    if (!sheet) {
      initializeAiSessionsSheet();
    }

    const sessionData = {
      sessionId: sessionId,
      studentName: studentName,
      studentNumber: studentNumber,
      step: step,
      title: '새 대화',
      messages: [],
      messageCount: 0,
      createdAt: now,
      updatedAt: now
    };

    ss.getSheetByName(AI_SESSIONS_SHEET).appendRow([
      sessionId,
      studentName,
      studentNumber,
      step,
      '새 대화',
      JSON.stringify([]),
      0,
      now,
      now
    ]);

    return { success: true, data: sessionData };

  } catch (error) {
    return { success: false, error: '세션 생성 실패: ' + error.message };
  }
}

/**
 * 학생의 AI 세션 목록 조회
 */
function getTtoriSessions(studentName, studentNumber, step) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(AI_SESSIONS_SHEET);

    if (!sheet) {
      return { success: true, data: [] };
    }

    const data = sheet.getDataRange().getValues();
    const sessions = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[1] === studentName && row[2] === studentNumber && (step === undefined || row[3] === step)) {
        sessions.push({
          sessionId: row[0],
          studentName: row[1],
          studentNumber: row[2],
          step: row[3],
          title: row[4],
          messageCount: row[6],
          createdAt: row[7],
          updatedAt: row[8]
        });
      }
    }

    // 최신순 정렬
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return { success: true, data: sessions };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * AI 세션 불러오기 (대화 기록 포함)
 */
function loadTtoriSession(sessionId) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(AI_SESSIONS_SHEET);

    if (!sheet) {
      return { success: false, error: '세션을 찾을 수 없습니다.' };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === sessionId) {
        const messages = JSON.parse(data[i][5] || '[]');
        return {
          success: true,
          data: {
            sessionId: data[i][0],
            studentName: data[i][1],
            studentNumber: data[i][2],
            step: data[i][3],
            title: data[i][4],
            messages: messages,
            messageCount: data[i][6],
            createdAt: data[i][7],
            updatedAt: data[i][8]
          }
        };
      }
    }

    return { success: false, error: '세션을 찾을 수 없습니다.' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * AI 세션 삭제
 */
function deleteTtoriSession(sessionId) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(AI_SESSIONS_SHEET);

    if (!sheet) {
      return { success: false, error: '시트를 찾을 수 없습니다.' };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === sessionId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: '세션을 찾을 수 없습니다.' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// Gemini API 연동
// ============================================

/**
 * 또리에게 메시지 전송 및 응답 받기
 */
function sendMessageToTtori(sessionId, userMessage, workContext) {
  try {
    // AI 설정 확인
    const aiSettings = getAiSettings();
    if (!aiSettings.aiEnabled || !aiSettings.aiApiKey) {
      return { success: false, error: 'AI 기능이 설정되지 않았습니다.' };
    }

    // 세션 로드
    const sessionResult = loadTtoriSession(sessionId);
    if (!sessionResult.success) {
      return sessionResult;
    }

    const session = sessionResult.data;

    // 메시지 수 제한 확인
    if (session.messageCount >= aiSettings.maxMessagesPerSession) {
      return {
        success: false,
        error: '이 대화는 최대 메시지 수에 도달했어요. 새 대화를 시작해주세요!',
        maxReached: true
      };
    }

    // 일일 사용량 체크
    const limitCheck = checkDailyLimit(session.studentName, session.studentNumber);
    if (!limitCheck.allowed) {
      return {
        success: false,
        error: `오늘은 또리와 ${limitCheck.used}번 대화했어요! 내일 다시 만나요~ 🌟`,
        limitReached: true
      };
    }

    // 사용 시간 체크
    if (!checkAllowedHours(aiSettings.allowedHours)) {
      return {
        success: false,
        error: '지금은 또리를 사용할 수 없는 시간이에요. 수업 시간에 다시 만나요!',
        timeRestricted: true
      };
    }

    // 시스템 프롬프트에 작품 컨텍스트 추가
    let contextPrompt = TTORI_SYSTEM_PROMPT;
    if (workContext) {
      contextPrompt += `\n\n## 현재 학생의 작품 상태\n${buildWorkContextString(workContext)}`;
    }

    // 대화 기록에 사용자 메시지 추가
    const messages = session.messages || [];
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // Gemini API 호출
    const aiResponse = callGeminiApi(aiSettings.aiApiKey, contextPrompt, messages);

    if (!aiResponse.success) {
      return aiResponse;
    }

    // AI 응답 추가
    messages.push({
      role: 'assistant',
      content: aiResponse.content,
      timestamp: new Date().toISOString()
    });

    // 세션 업데이트
    updateTtoriSession(sessionId, messages);

    // 일일 사용량 증가
    incrementDailyUsage(session.studentName, session.studentNumber);

    return {
      success: true,
      data: {
        response: aiResponse.content,
        messageCount: messages.length,
        sessionId: sessionId
      }
    };

  } catch (error) {
    return { success: false, error: '메시지 전송 실패: ' + error.message };
  }
}

/**
 * Gemini API 호출
 */
function callGeminiApi(apiKey, systemPrompt, messages) {
  try {
    // 메시지 형식 변환 (Gemini 형식)
    const contents = [];

    for (const msg of messages) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }

    const requestBody = {
      contents: contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 500,
        candidateCount: 1
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    const url = `${GEMINI_API_URL}?key=${apiKey}`;
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      console.error('Gemini API Error:', responseText);
      const errorData = JSON.parse(responseText);
      return {
        success: false,
        error: errorData.error?.message || 'AI 응답을 받지 못했습니다.'
      };
    }

    const data = JSON.parse(responseText);

    if (!data.candidates || data.candidates.length === 0) {
      return { success: false, error: '또리가 대답을 못 했어요. 다시 물어봐주세요!' };
    }

    const content = data.candidates[0].content.parts[0].text;

    return { success: true, content: content };

  } catch (error) {
    console.error('Gemini API Exception:', error);
    return { success: false, error: '또리와 연결하는 데 문제가 생겼어요: ' + error.message };
  }
}

/**
 * 세션 업데이트 (대화 기록 저장)
 */
function updateTtoriSession(sessionId, messages) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(AI_SESSIONS_SHEET);

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sessionId) {
      // 세션 제목 자동 생성 (첫 사용자 메시지 기반)
      let title = data[i][4];
      if (title === '새 대화' && messages.length > 0) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          title = firstUserMsg.content.substring(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '');
        }
      }

      sheet.getRange(i + 1, 5).setValue(title); // 제목
      sheet.getRange(i + 1, 6).setValue(JSON.stringify(messages)); // 대화기록
      sheet.getRange(i + 1, 7).setValue(messages.length); // 메시지수
      sheet.getRange(i + 1, 9).setValue(new Date().toISOString()); // 수정일

      break;
    }
  }
}

/**
 * 작품 컨텍스트 문자열 생성
 */
function buildWorkContextString(workContext) {
  if (!workContext) return '(작품 정보 없음)';

  let contextStr = '';

  if (workContext.title) {
    contextStr += `제목: ${workContext.title}\n`;
  }

  if (workContext.step) {
    contextStr += `현재 단계: Step ${workContext.step}\n`;
  }

  if (workContext.panels && Array.isArray(workContext.panels)) {
    contextStr += '\n현재 작성된 내용:\n';
    const panelNames = ['기(起)', '승(承)', '전(轉)', '결(結)'];

    workContext.panels.forEach((panel, index) => {
      if (panel && panel.content) {
        contextStr += `- ${panelNames[index] || `패널${index+1}`}: ${panel.content}\n`;
      } else {
        contextStr += `- ${panelNames[index] || `패널${index+1}`}: (아직 비어있음)\n`;
      }
    });
  }

  return contextStr;
}

// ============================================
// 남용 방지
// ============================================

/**
 * 일일 사용량 확인
 */
function checkDailyLimit(studentName, studentNumber) {
  const aiSettings = getAiSettings();
  const today = new Date().toISOString().split('T')[0];

  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(AI_USAGE_SHEET);

  if (!sheet) {
    initializeAiSessionsSheet();
    sheet = ss.getSheetByName(AI_USAGE_SHEET);
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === today && data[i][1] === studentName && data[i][2] === studentNumber) {
      const used = data[i][3] || 0;
      return {
        allowed: used < aiSettings.dailyLimitPerStudent,
        used: used,
        limit: aiSettings.dailyLimitPerStudent
      };
    }
  }

  return {
    allowed: true,
    used: 0,
    limit: aiSettings.dailyLimitPerStudent
  };
}

/**
 * 일일 사용량 증가
 */
function incrementDailyUsage(studentName, studentNumber) {
  const today = new Date().toISOString().split('T')[0];

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(AI_USAGE_SHEET);

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === today && data[i][1] === studentName && data[i][2] === studentNumber) {
      const newCount = (data[i][3] || 0) + 1;
      sheet.getRange(i + 1, 4).setValue(newCount);
      return;
    }
  }

  // 새 레코드 추가
  sheet.appendRow([today, studentName, studentNumber, 1]);
}

/**
 * 허용 시간 확인
 */
function checkAllowedHours(setting) {
  if (setting === 'always') return true;

  if (setting === 'school') {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 9 && hour < 15;
  }

  return true;
}

// ============================================
// AI 설정 관리
// ============================================

/**
 * AI 설정 가져오기
 * API 키는 Script Properties에서 암호화되어 저장됨 (보안 강화)
 */
function getAiSettings() {
  const settings = getSettings();

  // API 키는 Script Properties에서 가져옴 (보안 강화)
  const apiKey = getSecureApiKey();

  return {
    aiEnabled: settings.aiEnabled === 'true' || settings.aiEnabled === true,
    aiApiKey: apiKey,
    dailyLimitPerStudent: parseInt(settings.aiDailyLimit) || DEFAULT_AI_SETTINGS.dailyLimitPerStudent,
    maxMessagesPerSession: parseInt(settings.aiMaxMessages) || DEFAULT_AI_SETTINGS.maxMessagesPerSession,
    maxSessionsPerWork: parseInt(settings.aiMaxSessions) || DEFAULT_AI_SETTINGS.maxSessionsPerWork,
    allowedHours: settings.aiAllowedHours || DEFAULT_AI_SETTINGS.allowedHours
  };
}

// ============================================
// Script Properties 기반 API 키 관리 (보안 강화)
// ============================================

const API_KEY_PROPERTY = 'GEMINI_API_KEY';

/**
 * API 키를 Script Properties에서 안전하게 가져오기
 * @returns {string} API 키 (없으면 빈 문자열)
 */
function getSecureApiKey() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    return scriptProperties.getProperty(API_KEY_PROPERTY) || '';
  } catch (e) {
    console.error('API 키 조회 오류:', e.message);
    return '';
  }
}

/**
 * API 키를 Script Properties에 안전하게 저장
 * @param {string} apiKey - 저장할 API 키
 * @returns {object} { success, error? }
 */
function setSecureApiKey(apiKey) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();

    if (apiKey && apiKey.trim()) {
      scriptProperties.setProperty(API_KEY_PROPERTY, apiKey.trim());
    } else {
      // 빈 값이면 삭제
      scriptProperties.deleteProperty(API_KEY_PROPERTY);
    }

    return { success: true };
  } catch (e) {
    console.error('API 키 저장 오류:', e.message);
    return { success: false, error: 'API 키 저장 실패: ' + e.message };
  }
}

/**
 * API 키 존재 여부 확인 (키 값 노출 없이)
 * @returns {boolean} API 키 설정 여부
 */
function hasSecureApiKey() {
  const apiKey = getSecureApiKey();
  return apiKey && apiKey.length > 0;
}

/**
 * API 키 마스킹 (UI 표시용)
 * @returns {string} 마스킹된 API 키 (예: "AIza...xyz")
 */
function getMaskedApiKey() {
  const apiKey = getSecureApiKey();
  if (!apiKey || apiKey.length < 10) return '';

  return apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 3);
}

/**
 * AI 설정 저장
 * API 키는 Script Properties에 별도 저장 (보안 강화)
 */
function saveAiSettings(aiSettings) {
  try {
    // API 키는 Script Properties에 별도 저장 (스프레드시트에 저장 안 함)
    if (aiSettings.aiApiKey !== undefined) {
      const keyResult = setSecureApiKey(aiSettings.aiApiKey);
      if (!keyResult.success) {
        return keyResult;
      }
    }

    // 나머지 설정은 스프레드시트에 저장 (API 키 제외)
    const settingsToSave = {
      aiEnabled: aiSettings.aiEnabled ? 'true' : 'false',
      // aiApiKey는 더 이상 스프레드시트에 저장하지 않음
      aiDailyLimit: String(aiSettings.dailyLimitPerStudent || DEFAULT_AI_SETTINGS.dailyLimitPerStudent),
      aiMaxMessages: String(aiSettings.maxMessagesPerSession || DEFAULT_AI_SETTINGS.maxMessagesPerSession),
      aiMaxSessions: String(aiSettings.maxSessionsPerWork || DEFAULT_AI_SETTINGS.maxSessionsPerWork),
      aiAllowedHours: aiSettings.allowedHours || DEFAULT_AI_SETTINGS.allowedHours
    };

    const currentSettings = getSettings();
    const mergedSettings = Object.assign({}, currentSettings, settingsToSave);

    // 기존 aiApiKey가 스프레드시트에 있으면 삭제 (마이그레이션)
    if (mergedSettings.aiApiKey) {
      delete mergedSettings.aiApiKey;
    }

    return saveSettings(mergedSettings);

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * API 키 유효성 테스트
 */
function testAiApiKey(apiKey) {
  try {
    const testMessages = [{ role: 'user', content: '안녕?' }];
    const result = callGeminiApi(apiKey, '간단히 인사해주세요.', testMessages);

    if (result.success) {
      return { success: true, message: 'API 키가 유효합니다!' };
    } else {
      return { success: false, error: result.error || 'API 키가 유효하지 않습니다.' };
    }

  } catch (error) {
    return { success: false, error: 'API 키 테스트 실패: ' + error.message };
  }
}

/**
 * AI 사용 통계 조회 (교사용)
 */
function getAiUsageStats() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(AI_USAGE_SHEET);

    if (!sheet) {
      return { success: true, data: { totalUsage: 0, todayUsage: 0, students: [] } };
    }

    const data = sheet.getDataRange().getValues();
    const today = new Date().toISOString().split('T')[0];

    let totalUsage = 0;
    let todayUsage = 0;
    const studentUsage = {};

    for (let i = 1; i < data.length; i++) {
      const date = data[i][0];
      const name = data[i][1];
      const count = data[i][3] || 0;

      totalUsage += count;

      if (date === today) {
        todayUsage += count;
      }

      if (!studentUsage[name]) {
        studentUsage[name] = { total: 0, today: 0 };
      }
      studentUsage[name].total += count;
      if (date === today) {
        studentUsage[name].today += count;
      }
    }

    const students = Object.entries(studentUsage).map(([name, usage]) => ({
      name,
      total: usage.total,
      today: usage.today
    })).sort((a, b) => b.total - a.total);

    return {
      success: true,
      data: {
        totalUsage,
        todayUsage,
        students
      }
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}
