#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <ifaddrs.h>
#import <arpa/inet.h>
@interface LXDevice : NSObject <RCTBridgeModule>
@end
@implementation LXDevice
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_EXPORT_METHOD(setKeepAwake:(BOOL)value) { UIApplication.sharedApplication.idleTimerDisabled = value; }
RCT_EXPORT_METHOD(getDeviceName:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve(UIDevice.currentDevice.name); }
RCT_EXPORT_METHOD(getSystemLocales:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *language = NSLocale.preferredLanguages.firstObject.lowercaseString ?: @"en";
  if ([language hasPrefix:@"zh"]) resolve(([language containsString:@"hant"] || [language containsString:@"tw"] || [language containsString:@"hk"]) ? @"zh_tw" : @"zh_cn");
  else resolve(@"en_us");
}
RCT_EXPORT_METHOD(getWIFIIPV4Address:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  struct ifaddrs *interfaces = NULL; NSString *address = @"";
  if (getifaddrs(&interfaces) == 0) {
    for (struct ifaddrs *item = interfaces; item != NULL; item = item->ifa_next) {
      if (item->ifa_addr && item->ifa_addr->sa_family == AF_INET && strcmp(item->ifa_name, "en0") == 0) {
        char buffer[INET_ADDRSTRLEN];
        if (inet_ntop(AF_INET, &((struct sockaddr_in *)item->ifa_addr)->sin_addr, buffer, sizeof(buffer))) address = @(buffer);
      }
    }
    freeifaddrs(interfaces);
  }
  resolve(address);
}
RCT_EXPORT_METHOD(toast:(NSString *)message duration:(double)duration position:(NSString *)position) {
  UIView *view = RCTPresentedViewController().view; if (!view) return;
  UILabel *label = [[UILabel alloc] init]; label.text = message; label.numberOfLines = 0;
  label.textColor = UIColor.whiteColor; label.backgroundColor = [UIColor.blackColor colorWithAlphaComponent:0.8];
  label.font = [UIFont systemFontOfSize:14]; label.textAlignment = NSTextAlignmentCenter;
  label.layer.cornerRadius = 8; label.clipsToBounds = YES;
  CGSize size = [label sizeThatFits:CGSizeMake(MAX(80, view.bounds.size.width - 64), CGFLOAT_MAX)];
  CGFloat y = [position isEqualToString:@"top"] ? view.safeAreaInsets.top + 60 :
    [position isEqualToString:@"center"] ? (view.bounds.size.height - size.height)/2 : view.bounds.size.height - view.safeAreaInsets.bottom - size.height - 90;
  label.frame = CGRectMake((view.bounds.size.width - size.width - 24)/2, y, size.width + 24, size.height + 18);
  [view addSubview:label]; UIAccessibilityPostNotification(UIAccessibilityAnnouncementNotification, message);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(duration * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [UIView animateWithDuration:0.2 animations:^{ label.alpha = 0; } completion:^(BOOL done) { [label removeFromSuperview]; }];
  });
}
@end
