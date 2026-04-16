// 공용 누적 저장소 — fetch-paper.js와 read-paper.js가 공유한다.
// 기존 _fetch_results.json을 매 호출마다 덮어쓰던 버그를 해결하기 위해
// DOI 키 기반으로 머지하고 dedup한다.

const fs = require('fs');
const path = require('path');

const RESULTS_PATH = path.join(__dirname, '..', '..', 'findings', '_fetch_results.json');

// 안전 로드 — 파일이 없거나 깨졌으면 빈 객체로 fallback
function loadResults() {
  if (!fs.existsSync(RESULTS_PATH)) {
    return { succeeded: [], needsTier3: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
    return {
      succeeded: Array.isArray(data.succeeded) ? data.succeeded : [],
      needsTier3: Array.isArray(data.needsTier3) ? data.needsTier3 : [],
    };
  } catch {
    return { succeeded: [], needsTier3: [] };
  }
}

// 기존 결과 + 신규 결과를 머지하여 저장한다.
// 같은 DOI는 최신 결과가 우선이며, success로 확정된 DOI는 needsTier3에서 자동 제거된다.
function mergeResults(succeeded = [], needsTier3 = []) {
  const existing = loadResults();
  const dir = path.dirname(RESULTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // succeeded: 신규가 기존을 덮어씀 (Map 순서로 보장)
  const succeededByDoi = new Map();
  for (const r of existing.succeeded) {
    if (r && r.doi) succeededByDoi.set(r.doi, r);
  }
  for (const r of succeeded) {
    if (r && r.doi) succeededByDoi.set(r.doi, r);
  }

  // needsTier3: 같은 DOI는 신규 우선, success로 확정된 DOI는 제외
  const succeededDois = new Set(succeededByDoi.keys());
  const needsTier3ByDoi = new Map();
  for (const r of existing.needsTier3) {
    if (r && r.doi && !succeededDois.has(r.doi)) needsTier3ByDoi.set(r.doi, r);
  }
  for (const r of needsTier3) {
    if (r && r.doi && !succeededDois.has(r.doi)) needsTier3ByDoi.set(r.doi, r);
  }

  const succeededList = [...succeededByDoi.values()];
  const needsTier3List = [...needsTier3ByDoi.values()];

  const output = {
    timestamp: new Date().toISOString(),
    succeeded: succeededList,
    needsTier3: needsTier3List,
    summary: {
      total: succeededList.length + needsTier3List.length,
      succeeded: succeededList.length,
      needsTier3: needsTier3List.length,
    },
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2), 'utf-8');
  return output;
}

// 단일 레코드 추가용 헬퍼 — type은 'succeeded' 또는 'needsTier3'
function appendOne(record, type = 'needsTier3') {
  if (!record || !record.doi) return null;
  if (type === 'succeeded') {
    return mergeResults([record], []);
  }
  return mergeResults([], [record]);
}

module.exports = { loadResults, mergeResults, appendOne, RESULTS_PATH };
