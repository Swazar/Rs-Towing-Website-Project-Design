import { permissionsFor } from '../lib/owner-access.mjs';
import { recordIdentitySignIn } from '../lib/workspace-session.mjs';

export default {
  async userLogin({ user }) {
    if (!user?.id || !permissionsFor(user).length) return;
    try {
      // Netlify verifies the event before invoking this handler. Only a real
      // Identity login produces this proof. A token refresh does not.
      await recordIdentitySignIn(user);
    } catch (error) {
      console.error('Unable to record Identity sign-in:', error.name);
    }
  },
};
