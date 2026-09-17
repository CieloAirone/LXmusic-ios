#import <Foundation/Foundation.h>
@interface LXCrypto : NSObject
+ (NSString *)aes:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode decrypt:(BOOL)decrypt;
+ (NSString *)rsa:(NSString *)text key:(NSString *)key padding:(NSString *)padding decrypt:(BOOL)decrypt;
+ (NSDictionary *)generateKey;
+ (NSString *)digest:(NSString *)text md5:(BOOL)md5;
@end
