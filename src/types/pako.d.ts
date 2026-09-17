declare module 'pako' {
  const pako: {
    gzip: (input: Uint8Array | string) => Uint8Array
    ungzip: (input: Uint8Array) => Uint8Array
  }
  export default pako
}
