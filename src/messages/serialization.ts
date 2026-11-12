import { fromBase64, toBase64 } from './bytes';

export function stringify(value: any): string {
  return JSON.stringify(value, (_key: string, value: any) => {
    if (value instanceof Uint8Array) {
      return { type: 'Bytes', data: toBase64(value) };
    }

    return value;
  });
}

export function parse(text: string) {
  return JSON.parse(text, (_key: string, value: any) => {
    if (value?.type === 'Bytes') {
      return fromBase64(value.data);
    }

    return value;
  });
}
