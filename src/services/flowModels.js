/**
 * Model video Google Flow yang masih tersedia.
 * Mulai 5 Des 2026 Google menghentikan Omni 1.1 Flash, Veo 3.1 - Fast & Veo 3.1 - Quality;
 * yang tersisa: Omni 1.2 Flash & Veo 3.1 - Lite. Nilai lama (setelan / jadwal tersimpan) dipetakan otomatis.
 */
const FLOW_MODELS = ['Omni 1.2 Flash', 'Veo 3.1 - Lite'];
const DEFAULT_FLOW_MODEL = 'Veo 3.1 - Lite';

function normalizeFlowModel(model) {
  const s = String(model || '').replace(/google/i, '').trim();
  if (!s) return DEFAULT_FLOW_MODEL;
  if (/omni/i.test(s)) return 'Omni 1.2 Flash';
  if (/veo/i.test(s)) return 'Veo 3.1 - Lite';
  return s;
}

module.exports = { FLOW_MODELS, DEFAULT_FLOW_MODEL, normalizeFlowModel };
