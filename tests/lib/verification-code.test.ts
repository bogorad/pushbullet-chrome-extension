import { describe, expect, it } from 'vitest';

import { extractVerificationCode } from '../../src/lib/verification-code';

describe('extractVerificationCode', () => {
  it('extracts contiguous numeric codes', () => {
    expect(extractVerificationCode('SMS', 'the code it 527176.')).toBe('527176');
  });

  it('extracts hyphenated numeric codes', () => {
    expect(extractVerificationCode('SMS', 'your code is 527-176.')).toBe('527-176');
  });

  it('extracts three-character alpha-only grouped codes', () => {
    expect(extractVerificationCode('SMS', 'your code is abc-pqr.')).toBe('abc-pqr');
  });

  it('extracts four-character alphanumeric grouped codes', () => {
    expect(extractVerificationCode('SMS', 'your code is A1c2-P9r8.')).toBe(
      'A1c2-P9r8',
    );
  });

  it('extracts codes that precede the code phrase', () => {
    expect(extractVerificationCode('SMS', 'abc-pqr is your code.')).toBe('abc-pqr');
  });

  it('extracts codes on the next line after the code phrase', () => {
    expect(extractVerificationCode('SMS', 'Your verification code is:\n123456')).toBe(
      '123456',
    );
  });

  it('extracts codes on the next line directly after the code phrase', () => {
    expect(extractVerificationCode('SMS', 'Your verification code\n123456')).toBe(
      '123456',
    );
  });

  it('extracts codes on the previous line before the code phrase', () => {
    expect(extractVerificationCode('SMS', '123456\nis your OTP')).toBe('123456');
  });

  it('extracts a PIN separated from the keyword by intervening words and a colon', () => {
    expect(
      extractVerificationCode(
        'SMS',
        'DIGI: Para acceder a MI DIGI, debes introducir el siguiente PIN al iniciar sesion: 614612. Por tu seguridad, no compartas este PIN con nadie, en DIGI nunca te llamaremos solicitando este codigo.',
      ),
    ).toBe('614612');
  });

  it('extracts the PIN from the English translation of the DIGI message', () => {
    expect(
      extractVerificationCode(
        'SMS',
        'DIGI: To access MY DIGI, you must enter the following PIN when logging in: 614612. For your security, do not share this PIN with anyone; DIGI will never call you requesting this code.',
      ),
    ).toBe('614612');
  });

  it('extracts codes introduced by accented Spanish keywords', () => {
    expect(
      extractVerificationCode('SMS', 'Para iniciar sesión, introduce el código: 614612'),
    ).toBe('614612');
  });

  it('extracts codes introduced by the Spanish keyword clave', () => {
    expect(
      extractVerificationCode('SMS', 'Movistar: Tu clave de acceso es 482913. No la compartas.'),
    ).toBe('482913');
  });

  it('extracts codes introduced by accented contraseña', () => {
    expect(
      extractVerificationCode('SMS', 'Tu contraseña temporal es: 739204. Cámbiala al ingresar.'),
    ).toBe('739204');
  });

  it('extracts codes introduced by unaccented contrasena', () => {
    expect(
      extractVerificationCode('SMS', 'La contrasena de un solo uso es 581046 y expira en 10 minutos.'),
    ).toBe('581046');
  });

  it('ignores clave/contraseña mentions with no code digits nearby', () => {
    expect(
      extractVerificationCode('SMS', 'Cambia tu contraseña desde la app o solicita una clave nueva en tu sucursal.'),
    ).toBeNull();
  });

  it('extracts a 4-digit PIN after Spanish keyword context', () => {
    expect(
      extractVerificationCode('SMS', 'DIGI: Introduce el siguiente PIN al iniciar sesion: 1234. No lo compartas.'),
    ).toBe('1234');
  });

  it('extracts a 4-digit PIN after English keyword context', () => {
    expect(extractVerificationCode('SMS', 'Your PIN is 1234.')).toBe('1234');
  });

  it('ignores a 4-digit year with no code keyword context', () => {
    expect(
      extractVerificationCode('SMS', 'Tu factura de enero en 2024 ya esta disponible.'),
    ).toBeNull();
  });

  it('ignores a 4-digit time with no code keyword context', () => {
    expect(
      extractVerificationCode('SMS', 'Tu cita es manana a las 20:24 en la oficina.'),
    ).toBeNull();
  });

  it('ignores a 4-digit amount with no code keyword context', () => {
    expect(
      extractVerificationCode('SMS', 'El cargo de 1234 euros se aplico a tu cuenta.'),
    ).toBeNull();
  });

  it('ignores a bare 4-digit number in prose', () => {
    expect(
      extractVerificationCode('SMS', 'Quedan 1234 entradas disponibles para el evento.'),
    ).toBeNull();
  });

  it('ignores phone numbers after code help text', () => {
    expect(
      extractVerificationCode('SMS', 'Need help with your code? Call 800-555-1212.'),
    ).toBeNull();
  });

  it('ignores unrelated hyphenated tokens outside the code clause', () => {
    expect(
      extractVerificationCode('SMS', 'Ticket abc-pqr was opened. Enter the code later.'),
    ).toBeNull();
  });

  it('ignores unrelated hyphenated tokens on the next line after code help text', () => {
    expect(
      extractVerificationCode('SMS', 'Need help with your code\nTicket abc-pqr was opened.'),
    ).toBeNull();
  });
});
