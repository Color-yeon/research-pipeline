// PDF 다운로드 및 텍스트 추출 모듈
// Unpaywall/Semantic Scholar 등이 반환하는 PDF URL에서 텍스트를 추출한다.

const https = require('https');
const http = require('http');

const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB 제한
const MAX_TEXT_LENGTH = 80000; // 추출 텍스트 80KB 제한 (read-paper.js와 동일)
const DOWNLOAD_TIMEOUT = 30000; // 30초

/**
 * URL에서 PDF를 다운로드하여 Buffer로 반환한다.
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>}
 */
function downloadPdf(url) {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl, depth = 0) => {
      if (depth > 5) return reject(new Error('리다이렉트 초과'));

      const mod = targetUrl.startsWith('https') ? https : http;
      const req = mod.get(targetUrl, {
        timeout: DOWNLOAD_TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/octet-stream,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Referer': targetUrl.includes('doi.org') ? '' : new URL(targetUrl).origin + '/',
        }
      }, (res) => {
        // 리다이렉트 처리
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, targetUrl).href;
          return follow(next, depth + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const chunks = [];
        let totalSize = 0;

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > MAX_PDF_SIZE) {
            res.destroy();
            return reject(new Error('PDF 크기 초과 (50MB)'));
          }
          chunks.push(chunk);
        });

        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('다운로드 타임아웃')); });
    };

    follow(url);
  });
}

/**
 * PDF Buffer에서 텍스트를 추출한다.
 * @param {Buffer} pdfBuffer - PDF 데이터
 * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
 */
async function extractTextFromBuffer(pdfBuffer) {
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    await parser.destroy();

    let text = result.text || '';

    // 텍스트 정리
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')  // 과도한 빈 줄 제거
      .trim();

    // 길이 제한
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.substring(0, MAX_TEXT_LENGTH);
    }

    if (text.length < 100) {
      return { success: false, error: 'PDF에서 텍스트 추출 실패 (이미지 기반 PDF일 수 있음)' };
    }

    return { success: true, text };
  } catch (err) {
    return { success: false, error: `PDF 파싱 오류: ${err.message}` };
  }
}

/**
 * URL에서 PDF를 다운로드하고 텍스트를 추출한다.
 * @param {string} url - PDF URL
 * @returns {Promise<{ success: boolean, text?: string, error?: string, source: string }>}
 */
async function extractFromUrl(url) {
  try {
    const buffer = await downloadPdf(url);

    // PDF 매직 넘버 확인 (%PDF-)
    if (buffer.length < 5 || buffer.toString('ascii', 0, 5) !== '%PDF-') {
      // PDF가 아닐 수 있음 — HTML 응답일 가능성
      const head = buffer.toString('utf-8', 0, 500);
      if (head.includes('<html') || head.includes('<!DOCTYPE')) {
        return { success: false, error: 'PDF가 아닌 HTML 응답', source: 'pdf-extractor' };
      }
      // 다른 형식이지만 일단 시도
    }

    const result = await extractTextFromBuffer(buffer);
    return { ...result, source: 'pdf-extractor' };
  } catch (err) {
    return { success: false, error: err.message, source: 'pdf-extractor' };
  }
}

module.exports = { extractFromUrl, extractTextFromBuffer, downloadPdf };
