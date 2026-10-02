import { unavailable } from '../../lib/errors.js';

// Default provider: media generation off. The web app falls back to a placeholder video
// and browser speechSynthesis narration.
const disabled = () => { throw unavailable('Media generation is disabled (MEDIA_PROVIDER=none)'); };

export default {
  name: 'none',
  enabled: false,
  generateVideo: async () => disabled(),
  generateNarration: async () => disabled(),
};
