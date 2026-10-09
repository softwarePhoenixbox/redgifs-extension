// Edición del build (se fija al compilar con `wxt build --mode <edición>`; ver .env.<edición>).
//
//  basic      Solo funciones normales. El código premium NO se incluye en el paquete.
//  premium    Funciones premium bloqueadas hasta activar una licencia (clave o aprobación).
//  activated  Premium ya activo, sin consultar al servidor. Uso personal: NO publicar ni repartir.
export type Edition = 'basic' | 'premium' | 'activated';

const raw = import.meta.env.WXT_EDITION as string | undefined;
// Constante de compilación: en `basic` vale false y el bundler elimina todo el código bajo `if (HAS_PREMIUM)`.
export const HAS_PREMIUM: boolean = import.meta.env.WXT_EDITION !== 'basic';
export const EDITION: Edition = raw === 'basic' || raw === 'activated' ? raw : 'premium';
