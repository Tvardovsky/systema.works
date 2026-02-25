import {createHmac, timingSafeEqual} from 'crypto';

export function verifyHmacSha256(rawBody: string, secret: string, signatureHeader?: string | null): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

