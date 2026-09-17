#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface LXDocuments : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@property(nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock pendingReject;
@property(nonatomic, copy) NSString *destination;
@end
@implementation LXDocuments
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_EXPORT_METHOD(writeTextAtomic:(NSString *)path text:(NSString *)text resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  if ([text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:&error]) resolve(nil);
  else reject(@"E_WRITE", error.localizedDescription, error);
}
RCT_EXPORT_METHOD(pick:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.pendingResolve) { reject(@"E_BUSY", @"A document picker is already open", nil); return; }
  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter) { reject(@"E_PRESENT", @"No active screen", nil); return; }
  self.pendingResolve = resolve; self.pendingReject = reject;
  // Imports are persistent, since playlists may reference the selected audio file.
  NSString *documents = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  self.destination = [documents stringByAppendingPathComponent:[@"Imports" stringByAppendingPathComponent:NSUUID.UUID.UUIDString]];
  UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[UTTypeItem] asCopy:YES];
  picker.allowsMultipleSelection = NO; picker.delegate = self;
  [presenter presentViewController:picker animated:YES completion:nil];
}
- (void)finish { self.pendingResolve = nil; self.pendingReject = nil; self.destination = nil; }
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller { if (self.pendingResolve) self.pendingResolve([NSNull null]); [self finish]; }
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  NSURL *url = urls.firstObject;
  if (!url) { [self documentPickerWasCancelled:controller]; return; }
  BOOL access = [url startAccessingSecurityScopedResource];
  NSError *error = nil; NSFileManager *fm = NSFileManager.defaultManager;
  [fm createDirectoryAtPath:self.destination withIntermediateDirectories:YES attributes:nil error:&error];
  NSString *target = [self.destination stringByAppendingPathComponent:url.lastPathComponent];
  if (!error) [fm copyItemAtURL:url toURL:[NSURL fileURLWithPath:target] error:&error];
  if (access) [url stopAccessingSecurityScopedResource];
  if (error) self.pendingReject(@"E_IMPORT", error.localizedDescription, error);
  else self.pendingResolve(target);
  [self finish];
}
@end
