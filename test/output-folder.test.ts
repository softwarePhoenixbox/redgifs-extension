import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBFOLDER, applySubfolder, normalizeOutputSettings, sanitizeSubfolder } from '../utils/output-folder';

describe('sanitizeSubfolder', () => {
  it('deja pasar nombres normales y varios niveles', () => {
    expect(sanitizeSubfolder('redgifs')).toBe('redgifs');
    expect(sanitizeSubfolder('Videos/Favoritos')).toBe('Videos/Favoritos');
    expect(sanitizeSubfolder('Videos\\Favoritos')).toBe('Videos/Favoritos');
  });

  it('no permite salir de la carpeta ni rutas absolutas', () => {
    expect(sanitizeSubfolder('../../Windows')).toBe('Windows');
    expect(sanitizeSubfolder('/etc/passwd')).toBe('etc/passwd');
    expect(sanitizeSubfolder('C:\\Users\\x')).toBe('C/Users/x');
    expect(sanitizeSubfolder('..')).toBe('');
  });

  it('quita caracteres inválidos en Windows, puntos/espacios finales y nombres reservados', () => {
    expect(sanitizeSubfolder('a<b>:c|d?e*')).toBe('abcde');
    expect(sanitizeSubfolder('  carpeta. ')).toBe('carpeta');
    expect(sanitizeSubfolder('con')).toBe('_con');
    expect(sanitizeSubfolder('NUL.txt')).toBe('_NUL.txt');
  });

  it('vacío, no-texto y límites', () => {
    expect(sanitizeSubfolder('')).toBe('');
    expect(sanitizeSubfolder('   ')).toBe('');
    expect(sanitizeSubfolder(undefined)).toBe('');
    expect(sanitizeSubfolder('a/b/c/d/e/f')).toBe('a/b/c/d');
    expect(sanitizeSubfolder('x'.repeat(200)).length).toBe(60);
  });
});

describe('applySubfolder', () => {
  it('reemplaza la carpeta que traía el nombre', () => {
    expect(applySubfolder('redgifs/a.mp4', 'Mis videos')).toBe('Mis videos/a.mp4');
    expect(applySubfolder('redgifs/a.mp4', 'x/y')).toBe('x/y/a.mp4');
  });
  it('sin subcarpeta guarda directo en el destino', () => {
    expect(applySubfolder('redgifs/a.mp4', '')).toBe('a.mp4');
    expect(applySubfolder('a.mp4', '../..')).toBe('a.mp4');
  });
});

describe('normalizeOutputSettings', () => {
  it('sin nada guardado conserva el comportamiento anterior (Descargas/redgifs)', () => {
    expect(normalizeOutputSettings({})).toEqual({ mode: 'browser', subfolder: DEFAULT_SUBFOLDER, customName: null });
  });
  it('subcarpeta vacía guardada = sin subcarpeta', () => {
    expect(normalizeOutputSettings({ rgOutputSubfolder: '' }).subfolder).toBe('');
  });
  it('modo custom y nombre de carpeta', () => {
    expect(normalizeOutputSettings({ rgOutputMode: 'custom', rgOutputCustomName: 'E:\\', rgOutputSubfolder: 'clips' }))
      .toEqual({ mode: 'custom', subfolder: 'clips', customName: 'E:\\' });
  });
  it('valores raros caen a los predeterminados', () => {
    expect(normalizeOutputSettings({ rgOutputMode: 'otro', rgOutputSubfolder: 5, rgOutputCustomName: 3 }))
      .toEqual({ mode: 'browser', subfolder: DEFAULT_SUBFOLDER, customName: null });
  });
});
