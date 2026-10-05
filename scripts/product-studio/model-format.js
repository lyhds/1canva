// Only malformed model output is eligible for format recovery. Network, image,
// filesystem and Shopify errors must never enter this retry path by wording.
export class ModelFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelFormatError';
  }
}

export const nonEmptyText = value => typeof value === 'string' && !!value.trim();
