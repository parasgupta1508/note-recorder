// Engines that live in the local Lab helper (tools/lab/server.js). They are always listed, and usable only while the helper is connected.
// run({ id, stem }, { onUpdate(job) })  -> notes   (id = a clip saved in the helper; the helper does the work and keeps the result)
const LAB_HELPER_ENGINES = { basicpitch: ['Basic Pitch (helper)', 'Apache-2.0'], mpm: ['McLeod pitch (helper)', 'MIT'], pyin: ['pYIN (librosa, helper)', 'ISC'], crepe: ['CREPE (torchcrepe, helper)', 'MIT'] };
for (const k of Object.keys(LAB_HELPER_ENGINES)) {
  registerEngine({
    id: 'lab-' + k, role: 'transcriber', label: LAB_HELPER_ENGINES[k][0], version: '1',
    caps: { live: false, offline: true, polyphonic: k === 'basicpitch', instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: true, needsDownloadMB: 0, license: LAB_HELPER_ENGINES[k][1], sampleRate: null },
    params: {},
    async run(input, o = {}) {
      const key = k + (input.stem ? '.' + input.stem : '');
      const { job } = await labFetchJson('/api/midi', { id: input.id, engine: k, stem: input.stem || '' });
      await labWait(job, u => o.onUpdate && o.onUpdate(u));
      return (await labFetchJson(`/api/item/${input.id}/${key}.json`)).notes;
    },
    dispose() {},
  });
}
registerEngine({
  id: 'demucs', role: 'separator', label: 'Demucs htdemucs (helper)', version: '1',
  caps: { live: false, offline: true, polyphonic: true, instruments: ['all'], needsHelper: true, needsDownloadMB: 0, license: 'MIT', sampleRate: 22050 },
  params: {},
  async run() { throw new Error('Separation runs inside the Lab helper while it makes MIDI from a stem (pick a stem in the Lab).'); },
  dispose() {},
});
