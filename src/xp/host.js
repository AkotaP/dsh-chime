/** Independent XP component: share file-serving code, never the notification fiber. */
import { handleAssetRequest, handleListRequest } from '../host/index.js';

export const name = 'dsh-chime-xp';
export const inject = ['webServer'];

export function apply(ctx) {
  const register = () => {
    const web = ctx.get('webServer');
    const disposers = [];
    try {
      disposers.push(web.register({ kind: 'prefix', path: '/dsh-chime-xp/asset', handler: handleAssetRequest }));
      disposers.push(web.register({ kind: 'prefix', path: '/dsh-chime-xp/list', handler: handleListRequest }));
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      throw error;
    }
    return () => { for (const dispose of disposers.reverse()) dispose(); };
  };
  ctx.effect(register, 'dsh-chime-xp: independent audio routes');
}
