// The JSI installer is unavailable on some iOS runtimes. Keep Buffer and
// sync compression usable without native globals (including nested dependencies).
const base64 = require('base64-js')
export const byteLength = base64.byteLength
export const toByteArray = (text, removeLinebreaks = false) => base64.toByteArray(removeLinebreaks ? text.replace(/[\r\n]/g, '') : text)
export const fromByteArray = (bytes, urlSafe = false) => {
  const text = base64.fromByteArray(bytes)
  return urlSafe ? text.replace(/\+/g, '-').replace(/\//g, '_') : text
}
export const btoa = text => fromByteArray(Uint8Array.from(text.split(''), char => char.charCodeAt(0)))
export const atob = text => Array.from(toByteArray(text), byte => String.fromCharCode(byte)).join('')
export const shim = () => { global.btoa = btoa; global.atob = atob }
export const trimBase64Padding = text => text.replace(/[.=]{1,2}$/, '')
