/**
 * 스토리 구성 웹학습지 - 작품 관리 함수
 *
 * @version 1.0.0
 */

// ============================================
// 작품 저장/업데이트
// ============================================

/**
 * 학생 작품 저장 (신규 생성 또는 기존 업데이트)
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계 (1, 2, 3)
 * @param {object} workData - 작품 데이터 객체
 * @returns {object} { success, isNew?, savedAt?, error? }
 */
function saveWork(studentName, studentNumber, step, workData) {
  // 입력값 검증
  const nameValidation = validateName(studentName);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(studentNumber);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  if (![1, 2, 3].includes(parseInt(step))) {
    return { success: false, error: '올바른 단계를 선택해주세요.' };
  }

  if (!workData || typeof workData !== 'object') {
    return { success: false, error: '작품 데이터가 올바르지 않습니다.' };
  }

  // 시트 가져오기
  const sheetName = getWorkSheetName(step);
  const sheet = getOrCreateSheet(sheetName);
  const now = new Date();

  // 기존 작품 찾기 (캐시 사용)
  const existingWork = DataCache.findWork(nameValidation.value, numberValidation.value, step);

  // JSON 문자열로 변환
  const workDataJson = safeJsonStringify(workData);

  if (existingWork) {
    // 기존 작품 업데이트
    sheet.getRange(existingWork.row, 3).setValue(workDataJson); // 작품데이터
    sheet.getRange(existingWork.row, 5).setValue(now); // 수정일
    sheet.getRange(existingWork.row, 6).setValue(workData.isComplete || false); // 완료여부
    sheet.getRange(existingWork.row, 7).setValue(workData.status || 'draft'); // 상태

    // 캐시 무효화 (작품 데이터가 변경됨)
    DataCache.invalidateWorks(step);

    return {
      success: true,
      isNew: false,
      savedAt: now.toISOString()
    };
  } else {
    // 새 작품 추가
    sheet.appendRow([
      nameValidation.value,
      numberValidation.value,
      workDataJson,
      now,
      now,
      workData.isComplete || false,
      workData.status || 'draft'
    ]);

    // 캐시 무효화 (작품 데이터가 변경됨)
    DataCache.invalidateWorks(step);

    return {
      success: true,
      isNew: true,
      savedAt: now.toISOString()
    };
  }
}

// ============================================
// 작품 조회
// ============================================

/**
 * 학생의 특정 단계 작품 조회
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계 (1, 2, 3)
 * @returns {object} { success, data?, error? }
 */
function getWork(studentName, studentNumber, step) {
  // 입력값 검증
  const nameValidation = validateName(studentName);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(studentNumber);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  if (![1, 2, 3].includes(parseInt(step))) {
    return { success: false, error: '올바른 단계를 선택해주세요.' };
  }

  // 작품 찾기 (캐시 사용)
  const work = DataCache.findWork(nameValidation.value, numberValidation.value, step);

  if (!work) {
    return { success: true, data: null };
  }

  return {
    success: true,
    data: {
      studentName: work.studentName,
      studentNumber: work.studentNumber,
      workData: work.workData,
      createdAt: formatDate(work.createdAt),
      updatedAt: formatDate(work.updatedAt),
      isComplete: work.isComplete,
      status: work.status
    }
  };
}

/**
 * 학생의 모든 단계 작품 조회
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @returns {object} { success, data? }
 */
function getStudentWorks(studentName, studentNumber) {
  // 입력값 검증
  const nameValidation = validateName(studentName);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const numberValidation = validateNumber(studentNumber);
  if (!numberValidation.valid) {
    return { success: false, error: numberValidation.error };
  }

  const works = {};

  for (let step = 1; step <= 3; step++) {
    // 캐시 사용하여 작품 조회
    const work = DataCache.findWork(nameValidation.value, numberValidation.value, step);
    works[`step${step}`] = work ? {
      workData: work.workData,
      createdAt: formatDate(work.createdAt),
      updatedAt: formatDate(work.updatedAt),
      isComplete: work.isComplete,
      status: work.status
    } : null;
  }

  return { success: true, data: works };
}

/**
 * 특정 단계의 모든 작품 조회 (교사용)
 * @param {number} step - 단계 (1, 2, 3)
 * @returns {object} { success, data[] }
 */
function getAllWorks(step) {
  if (![1, 2, 3].includes(parseInt(step))) {
    return { success: false, error: '올바른 단계를 선택해주세요.' };
  }

  // 캐시 사용하여 작품 조회
  const cachedWorks = DataCache.getWorks(step);
  const works = [];

  for (const work of cachedWorks) {
    works.push({
      studentName: work.studentName,
      studentNumber: work.studentNumber,
      title: work.workData ? work.workData.title : '제목 없음',
      createdAt: formatDate(work.createdAt),
      updatedAt: formatDate(work.updatedAt),
      isComplete: work.isComplete,
      status: work.status
    });
  }

  // 학생 번호순 정렬
  works.sort((a, b) => a.studentNumber - b.studentNumber);

  return { success: true, data: works };
}

// ============================================
// 작품 내보내기
// ============================================

/**
 * 학생 작품을 AI 친화적 JSON으로 내보내기
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계 (1, 2, 3)
 * @returns {object} { success, json?, error? }
 */
function exportWorkAsJson(studentName, studentNumber, step) {
  const result = getWork(studentName, studentNumber, step);

  if (!result.success) {
    return result;
  }

  if (!result.data) {
    return { success: false, error: '작품을 찾을 수 없습니다.' };
  }

  const settings = getSettings();

  // AI 친화적 JSON 구조 생성
  const exportData = {
    meta: {
      title: result.data.workData.title || '제목 없음',
      author: studentName,
      authorNumber: studentNumber,
      step: step,
      stepName: getStepName(step),
      school: settings.schoolName || '',
      class: settings.className || '',
      teacher: settings.teacherName || '',
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
      exportedAt: new Date().toISOString()
    },
    content: result.data.workData,
    ai_prompt_suggestions: generateAiPromptSuggestions(result.data.workData, step)
  };

  return { success: true, json: exportData };
}

/**
 * AI 프롬프트 제안 생성
 * @param {object} workData - 작품 데이터
 * @param {number} step - 단계
 * @returns {object} 프롬프트 제안
 */
function generateAiPromptSuggestions(workData, step) {
  if (!workData) return {};

  const suggestions = {
    image_generation: [],
    story_expansion: []
  };

  if (step === 1 && workData.panels) {
    // 4컷 스토리의 경우
    for (const panel of workData.panels) {
      if (panel.description) {
        suggestions.image_generation.push({
          panel: panel.id,
          stage: panel.stageName,
          prompt: `동화책 스타일의 일러스트: ${panel.description}${panel.dialogue ? `, 대사: "${panel.dialogue}"` : ''}`
        });
      }
    }

    suggestions.story_expansion.push({
      prompt: `다음 4컷 스토리를 바탕으로 어린이 동화책을 써주세요: ${JSON.stringify(workData.panels.map(p => p.description).filter(Boolean))}`
    });
  }

  return suggestions;
}

/**
 * 단계 이름 가져오기
 * @param {number} step - 단계 번호
 * @returns {string} 단계 이름
 */
function getStepName(step) {
  switch (parseInt(step)) {
    case 1: return '4컷 스토리';
    case 2: return '장면 확장';
    case 3: return '콘티';
    default: return '알 수 없음';
  }
}

// ============================================
// 헬퍼 함수
// ============================================

/**
 * 작품 찾기
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계
 * @returns {object|null} 작품 객체 또는 null
 */
function findWork(studentName, studentNumber, step) {
  const sheetName = getWorkSheetName(step);
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === studentName && data[i][1] === studentNumber) {
      return rowToWork(data[i], i + 1);
    }
  }

  return null;
}

// ============================================
// 작품 상태 업데이트
// ============================================

/**
 * 작품 상태 변경
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계
 * @param {string} status - 새 상태 (draft/submitted/published)
 * @returns {object} { success, error? }
 */
function updateWorkStatus(studentName, studentNumber, step, status) {
  // 캐시 사용하여 작품 조회
  const work = DataCache.findWork(studentName, studentNumber, step);

  if (!work) {
    return { success: false, error: '작품을 찾을 수 없습니다.' };
  }

  if (!['draft', 'submitted', 'published'].includes(status)) {
    return { success: false, error: '올바른 상태를 선택해주세요.' };
  }

  const sheetName = getWorkSheetName(step);
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

  sheet.getRange(work.row, 7).setValue(status);

  // 캐시 무효화
  DataCache.invalidateWorks(step);

  return { success: true };
}

/**
 * 작품 완료 표시
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계
 * @param {boolean} isComplete - 완료 여부
 * @returns {object} { success, error? }
 */
function markWorkComplete(studentName, studentNumber, step, isComplete) {
  // 캐시 사용하여 작품 조회
  const work = DataCache.findWork(studentName, studentNumber, step);

  if (!work) {
    return { success: false, error: '작품을 찾을 수 없습니다.' };
  }

  const sheetName = getWorkSheetName(step);
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

  sheet.getRange(work.row, 6).setValue(isComplete === true);

  // 캐시 무효화
  DataCache.invalidateWorks(step);

  return { success: true };
}

// ============================================
// 작품 삭제
// ============================================

/**
 * 작품 삭제
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {number} step - 단계
 * @returns {object} { success, error? }
 */
function deleteWork(studentName, studentNumber, step) {
  // 캐시 사용하여 작품 조회
  const work = DataCache.findWork(studentName, studentNumber, step);

  if (!work) {
    return { success: false, error: '작품을 찾을 수 없습니다.' };
  }

  const sheetName = getWorkSheetName(step);
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

  sheet.deleteRow(work.row);

  // 캐시 무효화
  DataCache.invalidateWorks(step);

  return { success: true };
}

// ============================================
// 개인 모드 작품 관리
// ============================================

/**
 * 개인 모드 - 모든 작품 조회
 * 개인 모드에서는 학생이름='_personal', 학생번호=0으로 저장
 * @returns {object} { success, works[] }
 */
function getPersonalWorks() {
  const ss = SpreadsheetApp.getActive();
  const works = [];

  // 모든 단계의 작품 조회
  for (let step = 1; step <= 3; step++) {
    const sheetName = getWorkSheetName(step);
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) continue;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      // 개인 모드 작품만 필터링 (학생이름='_personal' 또는 학생번호=0)
      if (data[i][0] === '_personal' || data[i][1] === 0) {
        const workData = safeJsonParse(data[i][2]);

        works.push({
          id: `step${step}_row${i + 1}`,
          step: step,
          title: workData ? workData.title : '제목 없음',
          step1: step === 1 ? true : false,
          step2: step === 2 ? true : false,
          step3: step === 3 ? true : false,
          step4: workData && workData.panels && workData.panels.length >= 4 ? true : false,
          createdAt: formatDate(data[i][3]),
          updatedAt: formatDate(data[i][4]),
          isComplete: data[i][5],
          status: data[i][6] || 'draft'
        });
      }
    }
  }

  // 최근 수정일 기준 정렬
  works.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return { success: true, works: works };
}

/**
 * 개인 모드 - 작품 저장
 * @param {string} workId - 작품 ID (step1_row2 형식) 또는 null (새 작품)
 * @param {object} workData - 작품 데이터
 * @returns {object} { success, workId?, error? }
 */
function savePersonalWork(workId, workData) {
  if (!workData || typeof workData !== 'object') {
    return { success: false, error: '작품 데이터가 올바르지 않습니다.' };
  }

  const step = workData.step || 1;
  const sheetName = getWorkSheetName(step);
  const sheet = getOrCreateSheet(sheetName);
  const now = new Date();
  const workDataJson = safeJsonStringify(workData);

  if (workId) {
    // 기존 작품 업데이트
    const match = workId.match(/step(\d+)_row(\d+)/);
    if (match) {
      const rowNum = parseInt(match[2]);
      sheet.getRange(rowNum, 3).setValue(workDataJson);
      sheet.getRange(rowNum, 5).setValue(now);
      sheet.getRange(rowNum, 6).setValue(workData.isComplete || false);
      sheet.getRange(rowNum, 7).setValue(workData.status || 'draft');

      return { success: true, workId: workId, savedAt: now.toISOString() };
    }
  }

  // 새 작품 추가
  sheet.appendRow([
    '_personal',  // 개인 모드 표시
    0,            // 번호 0
    workDataJson,
    now,
    now,
    workData.isComplete || false,
    workData.status || 'draft'
  ]);

  const newRow = sheet.getLastRow();
  const newWorkId = `step${step}_row${newRow}`;

  return { success: true, workId: newWorkId, savedAt: now.toISOString(), isNew: true };
}

/**
 * 개인 모드 - 특정 작품 조회
 * @param {string} workId - 작품 ID (step1_row2 형식)
 * @returns {object} { success, data?, error? }
 */
function getPersonalWork(workId) {
  if (!workId) {
    return { success: false, error: '작품 ID가 필요합니다.' };
  }

  const match = workId.match(/step(\d+)_row(\d+)/);
  if (!match) {
    return { success: false, error: '올바른 작품 ID가 아닙니다.' };
  }

  const step = parseInt(match[1]);
  const rowNum = parseInt(match[2]);

  const sheetName = getWorkSheetName(step);
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

  if (!sheet) {
    return { success: false, error: '작품을 찾을 수 없습니다.' };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, 7).getValues()[0];

  if (!rowData[0]) {
    return { success: false, error: '작품을 찾을 수 없습니다.' };
  }

  const workData = safeJsonParse(rowData[2]);

  return {
    success: true,
    data: {
      workId: workId,
      step: step,
      workData: workData,
      createdAt: formatDate(rowData[3]),
      updatedAt: formatDate(rowData[4]),
      isComplete: rowData[5],
      status: rowData[6] || 'draft'
    }
  };
}

/**
 * 모든 작품 JSON 내보내기
 * @param {string} format - 내보내기 형식 (json)
 * @returns {object} { success, data?, error? }
 */
function exportAllWorksAsJson(format) {
  const settings = getSettings();
  const allWorks = {
    meta: {
      exportedAt: new Date().toISOString(),
      author: settings.teacherName || '익명',
      systemMode: settings.systemMode || 'classroom',
      version: VERSION
    },
    works: []
  };

  // 개인 모드 또는 전체 작품 내보내기
  const isPersonalMode = settings.systemMode === 'personal';

  for (let step = 1; step <= 3; step++) {
    const sheetName = getWorkSheetName(step);
    const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);

    if (!sheet) continue;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      // 개인 모드면 _personal 작품만, 아니면 전체
      if (isPersonalMode && data[i][0] !== '_personal' && data[i][1] !== 0) {
        continue;
      }

      const workData = safeJsonParse(data[i][2]);
      if (workData) {
        allWorks.works.push({
          step: step,
          stepName: getStepName(step),
          title: workData.title || '제목 없음',
          author: isPersonalMode ? settings.teacherName : data[i][0],
          workData: workData,
          createdAt: formatDate(data[i][3]),
          updatedAt: formatDate(data[i][4]),
          isComplete: data[i][5],
          status: data[i][6]
        });
      }
    }
  }

  return { success: true, data: allWorks };
}
