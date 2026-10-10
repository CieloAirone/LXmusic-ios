// Preserve the committed file during file-to-inline writes on iOS.
const fs = require('node:fs')
const path = require('node:path')
const root = path.dirname(require.resolve('@react-native-async-storage/async-storage/package.json'))
const file = path.join(root, 'ios/RNCAsyncStorage.mm')
let source = fs.readFileSync(file, 'utf8')
if (!source.includes('LX_STORAGE_COMMIT')) {
  const replace = (before, after) => {
    if (!source.includes(before)) throw Error('Unsupported AsyncStorage version: write contract changed')
    source = source.replace(before, after)
  }
  replace(
    '            [[NSFileManager defaultManager] removeItemAtPath:filePath error:nil];\n            [RCTGetCache() removeObjectForKey:key];',
    '            // LX_STORAGE_COMMIT: retain the old file until the manifest commits.\n            [RCTGetCache() removeObjectForKey:key];'
  )
  replace(
    '    [RCTGetCache() setObject:value forKey:key cost:value.length];\n    if (error) {',
    '    if (!error) [RCTGetCache() setObject:value forKey:key cost:value.length];\n    else [RCTGetCache() removeObjectForKey:key];\n    if (error) {'
  )
  const start = source.indexOf('RCT_EXPORT_METHOD(multiSet:')
  const end = source.indexOf('RCT_EXPORT_METHOD(multiMerge:', start)
  if (start < 0 || end < 0) throw Error('Cannot find AsyncStorage multiSet')
  let body = source.slice(start, end)
  const before = '    BOOL changedManifest = NO;'
  if (!body.includes(before)) throw Error('Cannot find AsyncStorage commit setup')
  body = body.replace(before, '    NSDictionary *committedManifest = [_manifest copy];\n' + before)
  const commit = '    if (changedManifest) {\n        [self _writeManifest:&errors];\n    }'
  if (!body.includes(commit)) throw Error('Cannot find AsyncStorage manifest commit')
  body = body.replace(commit, [
    '    if (changedManifest) {',
    '        if ([self _writeManifest:&errors]) {',
    '            _manifest = [committedManifest mutableCopy];',
    '            [RCTGetCache() removeAllObjects];',
    '        } else {',
    '            for (NSArray<NSString *> *entry in kvPairs) {',
    '                NSString *key = entry[0];',
    '                if (committedManifest[key] == (id)kCFNull && [_manifest[key] isKindOfClass:[NSString class]]) {',
    '                    [[NSFileManager defaultManager] removeItemAtPath:[self _filePathForKey:key] error:nil];',
    '                }',
    '            }',
    '        }',
    '    }',
  ].join('\n'))
  source = source.slice(0, start) + body + source.slice(end)
  fs.writeFileSync(file, source)
}
