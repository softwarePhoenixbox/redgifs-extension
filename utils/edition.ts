// Edición del build (se fija al compilar con `wxt build --mode <edición>`; ver .env.<edición>).
//
//  basic      Solo funciones normales. El código premium NO se incluye en el paquete.
//  premium    Funciones premium bloqueadas hasta activar una licencia (clave o aprobación).
//  activated  Premium ya activo, sin consultar al servidor. Uso personal: NO publicar ni repartir.
export type Edition = 'basic' | 'premium' | 'activated';

const raw = import.meta.env.WXT_EDITION as string | undefined;
export const EDITION: Edition = raw === 'basic' || raw === 'activated' ? raw : 'premium';
