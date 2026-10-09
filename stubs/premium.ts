// Sustituto público de `premium/` para la edición `basic`: no contiene lógica premium.
import type { PremiumApi } from '../utils/premium-api';

const notIncluded = (): never => {
  throw new Error('This feature is not included in the basic edition. / Esta función no está incluida en la edición básica.');
};

export const premium: PremiumApi = {
  exportLinks: notIncluded,
  saveBulk: notIncluded,
  downloadAll: notIncluded,
};
