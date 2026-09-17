#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import "LXCrypto.h"
@interface LXMedia : NSObject <RCTBridgeModule>
@end
@implementation LXMedia
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSURL *)url:(NSString *)path { return [path hasPrefix:@"file://"] ? [NSURL URLWithString:path] : [NSURL fileURLWithPath:path]; }
RCT_EXPORT_METHOD(readMetadata:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *url = [self url:path]; AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
  [asset loadValuesAsynchronouslyForKeys:@[@"commonMetadata", @"duration", @"tracks"] completionHandler:^{
    NSError *error = nil;
    if ([asset statusOfValueForKey:@"tracks" error:&error] == AVKeyValueStatusFailed) { reject(@"E_MEDIA", error.localizedDescription, error); return; }
    NSMutableDictionary *info = [@{@"name": url.lastPathComponent.stringByDeletingPathExtension ?: @"", @"singer": @"", @"albumName": @"",
      @"ext": url.pathExtension.lowercaseString, @"type": url.pathExtension.lowercaseString, @"interval": @0, @"bitrate": @"", @"size": @0} mutableCopy];
    NSDictionary *keys = @{AVMetadataCommonKeyTitle: @"name", AVMetadataCommonKeyArtist: @"singer", AVMetadataCommonKeyAlbumName: @"albumName"};
    for (AVMetadataItem *item in asset.commonMetadata) {
      NSString *key = item.commonKey ? keys[item.commonKey] : nil; if (key && item.stringValue) info[key] = item.stringValue;
    }
    double seconds = CMTimeGetSeconds(asset.duration); if (isfinite(seconds)) info[@"interval"] = @(seconds);
    AVAssetTrack *audio = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
    if (audio) info[@"bitrate"] = [NSString stringWithFormat:@"%.0f", audio.estimatedDataRate / 1000];
    NSNumber *size = nil; [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil]; if (size) info[@"size"] = size;
    resolve(info);
  }];
}
RCT_EXPORT_METHOD(readPic:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[self url:path] options:nil];
  [asset loadValuesAsynchronouslyForKeys:@[@"commonMetadata"] completionHandler:^{
    for (AVMetadataItem *item in asset.commonMetadata) {
      if ([item.commonKey isEqualToString:AVMetadataCommonKeyArtwork] && item.dataValue) {
        NSString *dir = [NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject stringByAppendingPathComponent:@"local-media-metadata"];
        NSError *error = nil; [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:&error];
        NSString *target = [dir stringByAppendingPathComponent:[[LXCrypto digest:path md5:NO] stringByAppendingString:@".jpg"]];
        if (!error && [item.dataValue writeToFile:target options:NSDataWritingAtomic error:&error]) resolve(target);
        else reject(@"E_ARTWORK", error.localizedDescription, error);
        return;
      }
    }
    resolve(@"");
  }];
}
RCT_EXPORT_METHOD(readLyric:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[self url:path] options:nil];
  [asset loadValuesAsynchronouslyForKeys:@[@"lyrics"] completionHandler:^{ resolve(asset.lyrics ?: @""); }];
}
@end
