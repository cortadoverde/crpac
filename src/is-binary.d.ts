declare module 'is-binary' {
  /**
   * Checks if a Buffer or string contains binary content.
   * @param content The Buffer or string to check.
   * @returns `true` if the content is binary, otherwise `false`.
   */
  function isBinary(content: Buffer | string): boolean;
  export = isBinary;
}