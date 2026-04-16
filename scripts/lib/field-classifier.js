// 논문의 제목과 초록을 기반으로 4개 분야 중 하나로 분류한다.
// 점수 기반: 제목 매칭 3배 가중, 초록 매칭 1배 가중.

const FIELDS = {
  'drug-discovery': {
    display: '신약개발',
    patterns: [
      // 고가중치 — 분야 확정적 키워드
      { re: /\bdrug\s+discovery\b/i, w: 10 },
      { re: /\bdrug\s+design\b/i, w: 10 },
      { re: /\bvirtual\s+screening\b/i, w: 10 },
      { re: /\bADME[T]?\b/, w: 10 },
      { re: /\bde\s+novo\s+(drug|molecule)\b/i, w: 10 },
      { re: /\bdrug[\s-]+target\b/i, w: 10 },
      { re: /\bdrug\s+repurposing\b/i, w: 10 },
      { re: /\blead\s+optimization\b/i, w: 10 },
      { re: /\bhit[\s-]+to[\s-]+lead\b/i, w: 10 },
      { re: /\bdrug[\s-]+like(ness)?\b/i, w: 8 },
      // 중가중치 — 분야 지지 키워드
      { re: /\bbinding\s+affinity\b/i, w: 5 },
      { re: /\bpharmaco(kinetics?|dynamics?)\b/i, w: 5 },
      { re: /\bmolecular\s+docking\b/i, w: 5 },
      { re: /\bcompound\s+generation\b/i, w: 5 },
      { re: /\btarget\s+identification\b/i, w: 5 },
      { re: /\bpharmaceutical\b/i, w: 5 },
      { re: /\btherapeutic\b/i, w: 3 },
      { re: /\bscaffold\b/i, w: 3 },
      // 저가중치 — 보조 키워드
      { re: /\binhibitor\b/i, w: 2 },
      { re: /\bligand\b/i, w: 2 },
      { re: /\breceptor\b/i, w: 2 },
      { re: /\btoxicity\b/i, w: 3 },
    ]
  },

  'biology': {
    display: '생물학',
    patterns: [
      { re: /\bprotein\s+structure\s+prediction\b/i, w: 10 },
      { re: /\bprotein\s+folding\b/i, w: 10 },
      { re: /\bgene\s+expression\b/i, w: 10 },
      { re: /\bsingle[\s-]+cell\b/i, w: 10 },
      { re: /\bprotein[\s-]+protein\s+interaction\b/i, w: 10 },
      { re: /\bgene\s+regulatory\b/i, w: 8 },
      { re: /\bprotein\s+function\b/i, w: 8 },
      { re: /\bgene\s+ontology\b/i, w: 8 },
      { re: /\bcell\s+type\s+(annotation|classification|identification)\b/i, w: 8 },
      { re: /\bbiological\s+network\b/i, w: 5 },
      { re: /\benzyme\s+(function|classification|catalysis)\b/i, w: 8 },
      { re: /\bphenotype\b/i, w: 5 },
      { re: /\bgenotype\b/i, w: 5 },
      { re: /\btranscription\s+factor\b/i, w: 8 },
      { re: /\bcellular\b/i, w: 3 },
      { re: /\bprotein\s+design\b/i, w: 8 },
      { re: /\bantibody\b/i, w: 8 },
      { re: /\bepitope\b/i, w: 8 },
      { re: /\bprotein\b/i, w: 2 },
      { re: /\bbiological\b/i, w: 2 },
    ]
  },

  'bioinformatics': {
    display: '생물정보학',
    patterns: [
      { re: /\bprotein\s+language\s+model\b/i, w: 10 },
      { re: /\bsequence\s+(analysis|modeling|alignment)\b/i, w: 10 },
      { re: /\bmultiple\s+sequence\s+alignment\b/i, w: 10 },
      { re: /\bhomology\s+(detection|search|modeling)\b/i, w: 10 },
      { re: /\bproteomics\b/i, w: 10 },
      { re: /\btranscriptomics\b/i, w: 10 },
      { re: /\bmetagenomic\b/i, w: 10 },
      { re: /\bbioinformatics\b/i, w: 10 },
      { re: /\bgenomics\b/i, w: 8 },
      { re: /\bgenome[\s-]+wide\b/i, w: 8 },
      { re: /\bvariant\s+(calling|effect|prediction)\b/i, w: 8 },
      { re: /\bbiomarker\b/i, w: 5 },
      { re: /\bDNA\b/, w: 5 },
      { re: /\bRNA\b/, w: 5 },
      { re: /\bmRNA\b/, w: 5 },
      { re: /\bamino\s+acid\b/i, w: 5 },
      { re: /\bsequence\b/i, w: 2 },
      { re: /\bgenome\b/i, w: 3 },
    ]
  },

  'computational-chemistry': {
    display: '계산화학',
    patterns: [
      { re: /\bmolecular\s+dynamics\b/i, w: 10 },
      { re: /\bforce\s+field\b/i, w: 10 },
      { re: /\bquantum\s+chemistry\b/i, w: 10 },
      { re: /\bDFT\b/, w: 10 },
      { re: /\bdensity\s+functional\b/i, w: 10 },
      { re: /\bmolecular\s+simulation\b/i, w: 10 },
      { re: /\bpotential\s+energy\s+surface\b/i, w: 10 },
      { re: /\bab\s+initio\b/i, w: 10 },
      { re: /\bmolecular\s+mechanics\b/i, w: 8 },
      { re: /\bfree\s+energy\s+perturbation\b/i, w: 10 },
      { re: /\bquantum\s+mechani(cs|cal)\b/i, w: 8 },
      { re: /\binteratomic\s+potential\b/i, w: 10 },
      { re: /\bconformation(al)?\s+(search|generation|space|sampling)\b/i, w: 8 },
      { re: /\bSMILES\b/, w: 8 },
      { re: /\bmolecular\s+(property|properties)\b/i, w: 5 },
      { re: /\bmolecular\s+(representation|fingerprint|descriptor)\b/i, w: 5 },
      { re: /\bmolecular\s+graph\b/i, w: 5 },
      { re: /\bmolecular\s+generation\b/i, w: 5 },
      { re: /\bGNN\b/, w: 3 },
      { re: /\bequivariant\b/i, w: 5 },
      { re: /\b3D\s+(molecule|molecular|conformation)\b/i, w: 5 },
      { re: /\bmolecule\b/i, w: 2 },
      { re: /\bchemical\b/i, w: 2 },
    ]
  }
};

/**
 * 논문을 4개 분야 중 하나로 분류한다.
 * @param {string} title - 논문 제목
 * @param {string} abstract - 논문 초록
 * @returns {{ field: string|null, scores: object, display: string|null }}
 */
function classifyPaper(title, abstract) {
  const scores = {};

  for (const [fieldId, fieldDef] of Object.entries(FIELDS)) {
    let score = 0;
    for (const { re, w } of fieldDef.patterns) {
      // 제목 매칭: 3배 가중 (제목에 있으면 핵심 주제일 가능성 높음)
      if (re.test(title || '')) score += w * 3;
      // 초록 매칭: 1배 가중
      if (re.test(abstract || '')) score += w;
    }
    scores[fieldId] = score;
  }

  // 최고 점수 분야 선택
  let bestField = null;
  let bestScore = 0;
  for (const [field, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestField = field;
      bestScore = score;
    }
  }

  // 최소 점수 기준: 5점 이상이어야 분류 (너무 낮으면 관련 없는 논문)
  if (bestScore < 5) {
    return { field: null, scores, display: null };
  }

  return {
    field: bestField,
    scores,
    display: FIELDS[bestField].display
  };
}

/**
 * 모든 분야 정의를 반환한다.
 */
function getFieldDefinitions() {
  return Object.entries(FIELDS).map(([id, def]) => ({
    id,
    display: def.display,
  }));
}

module.exports = { classifyPaper, getFieldDefinitions, FIELDS };
