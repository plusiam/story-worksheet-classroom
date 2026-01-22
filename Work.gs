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
 * Lock Service로 동시 접속 시 데이터 충돌 방지
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

  // Lock Service - 동시 저장 충돌 방지
  const lock = LockService.getScriptLock();

  try {
    // 최대 10초 대기 후 락 획득
    if (!lock.tryLock(10000)) {
      return { success: false, error: '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
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
      // 기존 작품 업데이트 - 배치 쓰기로 최적화 (4번 → 1번 호출)
      // 컬럼: 3=작품데이터, 4=생성일(수정X), 5=수정일, 6=완료여부, 7=상태
      sheet.getRange(existingWork.row, 3, 1, 5).setValues([[
        workDataJson,                    // 3: 작품데이터
        existingWork.createdAt || now,   // 4: 생성일 (기존값 유지)
        now,                             // 5: 수정일
        workData.isComplete || false,    // 6: 완료여부
        workData.status || 'draft'       // 7: 상태
      ]]);

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
  } catch (e) {
    console.error('작품 저장 오류:', e.message);
    return { success: false, error: '작품 저장 중 오류가 발생했습니다: ' + e.message };
  } finally {
    // 락 해제 (반드시 실행)
    lock.releaseLock();
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

// ============================================
// 스토리보드 PDF 내보내기 (Step 3용)
// ============================================

/**
 * 스토리보드를 PDF로 내보내기
 * Google Docs를 임시로 생성하여 PDF 변환 후 URL 반환
 * @param {string} studentName - 학생 이름
 * @param {number} studentNumber - 학생 번호
 * @param {string} title - 작품 제목
 * @param {Array} scenes - 장면 배열
 * @param {object} sceneImages - 장면별 이미지 데이터 { sceneId: { imageData, ... } }
 * @returns {object} { success, pdfUrl?, error? }
 */
function exportStoryboardPDF(studentName, studentNumber, title, scenes, sceneImages) {
  try {
    if (!scenes || scenes.length === 0) {
      return { success: false, error: '내보낼 장면이 없습니다.' };
    }

    const settings = getSettings();

    // 임시 Google Doc 생성
    const doc = DocumentApp.create(`스토리보드_${studentName}_${new Date().getTime()}`);
    const body = doc.getBody();

    // 스타일 설정
    body.setMarginTop(36);
    body.setMarginBottom(36);
    body.setMarginLeft(36);
    body.setMarginRight(36);

    // 제목
    const titlePara = body.appendParagraph(title || '제목 없음');
    titlePara.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    // 작성자 정보
    const infoPara = body.appendParagraph(`작성자: ${studentName} (${studentNumber}번)`);
    infoPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    infoPara.setFontSize(10);
    infoPara.setForegroundColor('#666666');

    // 학교/반 정보
    if (settings.schoolName || settings.className) {
      const schoolPara = body.appendParagraph(`${settings.schoolName || ''} ${settings.className || ''}`);
      schoolPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      schoolPara.setFontSize(10);
      schoolPara.setForegroundColor('#666666');
    }

    body.appendParagraph(''); // 빈 줄

    // 장면별 내용 추가
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imageInfo = sceneImages ? sceneImages[scene.id] : null;

      // 장면 구분선 (첫 장면 제외)
      if (i > 0) {
        body.appendHorizontalRule();
      }

      // 장면 번호 및 제목
      const sceneTitle = body.appendParagraph(`장면 ${i + 1}: ${scene.stageName || ''}`);
      sceneTitle.setHeading(DocumentApp.ParagraphHeading.HEADING2);

      // 이미지 추가 (있는 경우)
      if (imageInfo && imageInfo.imageData) {
        try {
          // Base64 이미지 디코딩
          const base64Data = imageInfo.imageData.replace(/^data:image\/\w+;base64,/, '');
          const imageBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/png', 'scene_' + i + '.png');

          // 이미지 삽입 (크기 조정)
          const inlineImage = body.appendImage(imageBlob);

          // 이미지 크기 조정 (최대 400px 너비)
          const width = inlineImage.getWidth();
          const height = inlineImage.getHeight();
          const maxWidth = 400;

          if (width > maxWidth) {
            const ratio = maxWidth / width;
            inlineImage.setWidth(maxWidth);
            inlineImage.setHeight(height * ratio);
          }
        } catch (imgError) {
          console.error('이미지 삽입 오류:', imgError);
          const noImagePara = body.appendParagraph('[이미지를 불러올 수 없습니다]');
          noImagePara.setForegroundColor('#999999');
          noImagePara.setItalic(true);
        }
      } else {
        const noImagePara = body.appendParagraph('[이미지 없음]');
        noImagePara.setForegroundColor('#999999');
        noImagePara.setItalic(true);
      }

      // 장면 설명
      if (scene.description) {
        const descPara = body.appendParagraph(scene.description);
        descPara.setFontSize(11);
      }

      // 대사 (있는 경우)
      if (scene.dialogue) {
        const dialoguePara = body.appendParagraph(`"${scene.dialogue}"`);
        dialoguePara.setItalic(true);
        dialoguePara.setForegroundColor('#336699');
      }

      body.appendParagraph(''); // 빈 줄
    }

    // 문서 저장 및 닫기
    doc.saveAndClose();

    // PDF로 변환
    const docFile = DriveApp.getFileById(doc.getId());
    const pdfBlob = docFile.getAs('application/pdf');

    // PDF 파일 생성
    const pdfFile = DriveApp.createFile(pdfBlob);
    pdfFile.setName(`스토리보드_${studentName}_${title || '작품'}.pdf`);

    // PDF URL 가져오기
    const pdfUrl = pdfFile.getUrl();

    // 임시 문서 삭제 (PDF만 남김)
    docFile.setTrashed(true);

    // 일정 시간 후 PDF도 삭제하도록 트리거 설정 (선택사항)
    // 학생이 다운로드할 시간 확보 후 정리

    return {
      success: true,
      pdfUrl: pdfUrl,
      fileName: pdfFile.getName()
    };

  } catch (error) {
    console.error('PDF 생성 오류:', error);
    return { success: false, error: 'PDF 생성 중 오류가 발생했습니다: ' + error.message };
  }
}

/**
 * 간단한 HTML 기반 스토리보드 미리보기 생성
 * (PDF 생성이 실패할 경우의 폴백)
 * @param {string} studentName - 학생 이름
 * @param {string} title - 작품 제목
 * @param {Array} scenes - 장면 배열
 * @param {object} sceneImages - 장면별 이미지 데이터
 * @returns {string} HTML 문자열
 */
function generateStoryboardHtml(studentName, title, scenes, sceneImages) {
  const settings = getSettings();

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title || '스토리보드'}</title>
      <style>
        body { font-family: 'Noto Sans KR', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
        h1 { text-align: center; color: #333; }
        .info { text-align: center; color: #666; margin-bottom: 30px; }
        .scene { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .scene-title { font-weight: bold; font-size: 1.1em; margin-bottom: 12px; color: #4A90D9; }
        .scene-image { max-width: 100%; border-radius: 8px; margin-bottom: 12px; }
        .scene-desc { line-height: 1.6; }
        .scene-dialogue { font-style: italic; color: #336699; margin-top: 8px; padding-left: 12px; border-left: 3px solid #336699; }
        .no-image { color: #999; font-style: italic; padding: 40px; background: #f5f5f5; border-radius: 8px; text-align: center; }
      </style>
    </head>
    <body>
      <h1>${title || '제목 없음'}</h1>
      <p class="info">작성자: ${studentName} | ${settings.schoolName || ''} ${settings.className || ''}</p>
  `;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const imageInfo = sceneImages ? sceneImages[scene.id] : null;

    html += `
      <div class="scene">
        <div class="scene-title">장면 ${i + 1}: ${scene.stageName || ''}</div>
        ${imageInfo && imageInfo.imageData ?
          `<img src="${imageInfo.imageData}" class="scene-image" alt="장면 ${i + 1}">` :
          `<div class="no-image">🖼️ 이미지 없음</div>`
        }
        <div class="scene-desc">${scene.description || ''}</div>
        ${scene.dialogue ? `<div class="scene-dialogue">"${scene.dialogue}"</div>` : ''}
      </div>
    `;
  }

  html += '</body></html>';

  return html;
}

// ============================================
// 그림 가이드 PDF 내보내기
// ============================================

/**
 * 나의 그림 가이드를 PDF로 내보내기
 * @param {string} sceneName - 장면 이름
 * @param {string} sceneDescription - 장면 설명
 * @param {object} hints - 힌트 데이터 { whatToDraw, whereToPut, tips }
 * @param {Array} userAdditions - 사용자 추가 아이디어
 * @param {object} editedItems - 수정된 힌트 항목
 * @param {string} studentName - 학생 이름
 * @param {string} title - 작품 제목
 * @returns {object} { success, pdfUrl?, error? }
 */
function exportDrawingGuidePDF(sceneName, sceneDescription, hints, userAdditions, editedItems, studentName, title) {
  try {
    const settings = getSettings();

    // 임시 Google Doc 생성
    const doc = DocumentApp.create(`나의그림가이드_${studentName}_${new Date().getTime()}`);
    const body = doc.getBody();

    // 스타일 설정
    body.setMarginTop(40);
    body.setMarginBottom(40);
    body.setMarginLeft(50);
    body.setMarginRight(50);

    // 제목
    const titlePara = body.appendParagraph('🎨 나의 그림 가이드');
    titlePara.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    // 작품 정보
    const infoPara = body.appendParagraph(`작품: ${title || '제목 없음'} | 작성자: ${studentName}`);
    infoPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    infoPara.setFontSize(10);
    infoPara.setForegroundColor('#666666');

    // 장면 정보
    const scenePara = body.appendParagraph(`📍 ${sceneName}`);
    scenePara.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    scenePara.setSpacingBefore(20);

    if (sceneDescription) {
      const descPara = body.appendParagraph(sceneDescription);
      descPara.setFontSize(11);
      descPara.setForegroundColor('#555555');
      descPara.setItalic(true);
    }

    body.appendParagraph(''); // 빈 줄

    // 무엇을 그릴까 섹션
    if (hints && hints.whatToDraw && hints.whatToDraw.length > 0) {
      const section1Title = body.appendParagraph('🖌️ 무엇을 그릴까?');
      section1Title.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      section1Title.setSpacingBefore(15);

      for (let i = 0; i < hints.whatToDraw.length; i++) {
        const itemKey = `whatToDraw_${i}`;
        const displayText = editedItems && editedItems[itemKey] ? editedItems[itemKey] : hints.whatToDraw[i];
        const isEdited = editedItems && editedItems[itemKey];

        const itemPara = body.appendParagraph(`• ${displayText}${isEdited ? ' ✏️' : ''}`);
        itemPara.setFontSize(11);
        if (isEdited) {
          itemPara.setForegroundColor('#b45309'); // 수정됨 표시 - 주황색
        }
      }
    }

    // 어디에 배치할까 섹션
    if (hints && hints.whereToPut && hints.whereToPut.length > 0) {
      const section2Title = body.appendParagraph('📐 어디에 배치할까?');
      section2Title.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      section2Title.setSpacingBefore(15);

      for (let i = 0; i < hints.whereToPut.length; i++) {
        const itemKey = `whereToPut_${i}`;
        const displayText = editedItems && editedItems[itemKey] ? editedItems[itemKey] : hints.whereToPut[i];
        const isEdited = editedItems && editedItems[itemKey];

        const itemPara = body.appendParagraph(`• ${displayText}${isEdited ? ' ✏️' : ''}`);
        itemPara.setFontSize(11);
        if (isEdited) {
          itemPara.setForegroundColor('#b45309');
        }
      }
    }

    // 분위기 표현 팁 섹션
    if (hints && hints.tips && hints.tips.length > 0) {
      const section3Title = body.appendParagraph('✨ 분위기 표현 팁');
      section3Title.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      section3Title.setSpacingBefore(15);

      for (let i = 0; i < hints.tips.length; i++) {
        const itemKey = `tips_${i}`;
        const displayText = editedItems && editedItems[itemKey] ? editedItems[itemKey] : hints.tips[i];
        const isEdited = editedItems && editedItems[itemKey];

        const itemPara = body.appendParagraph(`• ${displayText}${isEdited ? ' ✏️' : ''}`);
        itemPara.setFontSize(11);
        if (isEdited) {
          itemPara.setForegroundColor('#b45309');
        }
      }
    }

    // 나만의 아이디어 섹션
    if (userAdditions && userAdditions.length > 0) {
      const section4Title = body.appendParagraph('💭 나만의 아이디어');
      section4Title.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      section4Title.setSpacingBefore(15);

      for (const idea of userAdditions) {
        const itemPara = body.appendParagraph(`★ ${idea}`);
        itemPara.setFontSize(11);
        itemPara.setForegroundColor('#047857'); // 초록색 - 사용자 아이디어
      }
    }

    // 푸터
    body.appendParagraph(''); // 빈 줄
    body.appendHorizontalRule();
    const footerPara = body.appendParagraph(`${settings.schoolName || ''} ${settings.className || ''} | 스토리 구성 웹학습지`);
    footerPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    footerPara.setFontSize(9);
    footerPara.setForegroundColor('#999999');

    // 문서 저장 및 닫기
    doc.saveAndClose();

    // PDF로 변환
    const docFile = DriveApp.getFileById(doc.getId());
    const pdfBlob = docFile.getAs('application/pdf');

    // PDF 파일 생성
    const pdfFile = DriveApp.createFile(pdfBlob);
    pdfFile.setName(`나의그림가이드_${studentName}_${sceneName || '장면'}.pdf`);

    // PDF URL 가져오기
    const pdfUrl = pdfFile.getUrl();

    // 임시 문서 삭제
    docFile.setTrashed(true);

    return {
      success: true,
      pdfUrl: pdfUrl,
      fileName: pdfFile.getName()
    };

  } catch (error) {
    console.error('그림 가이드 PDF 생성 오류:', error);
    return { success: false, error: '그림 가이드 PDF 생성 중 오류가 발생했습니다: ' + error.message };
  }
}
