#import "RNLyrelog.h"

#if __has_include(<LyrelogReactNative/LyrelogReactNative-Swift.h>)
#import <LyrelogReactNative/LyrelogReactNative-Swift.h>
#else
#import "LyrelogReactNative-Swift.h"
#endif

@implementation RNLyrelog

+ (NSString *)moduleName
{
  return @"Lyrelog";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeLyrelogSpecJSI>(params);
}

- (void)start:(NSDictionary *)config
{
  [LyrelogBridge start:config];
}

- (void)log:(NSString *)level
    message:(NSString *)message
   category:(NSString *)category
      attrs:(NSDictionary *)attrs
    payload:(NSDictionary *)payload
{
  [LyrelogBridge log:level message:message category:category attrs:attrs payload:payload];
}

- (NSNumber *)logNow:(NSString *)level
             message:(NSString *)message
            category:(NSString *)category
               attrs:(NSDictionary *)attrs
             payload:(NSDictionary *)payload
           timeoutMs:(double)timeoutMs
{
  return @([LyrelogBridge logNow:level message:message category:category attrs:attrs payload:payload timeoutMs:timeoutMs]);
}

- (void)setUser:(NSString *)id
{
  [LyrelogBridge setUser:id];
}

- (void)setConsent:(NSString *)consent
{
  [LyrelogBridge setConsent:consent];
}

- (void)screen:(NSString *)name attrs:(NSDictionary *)attrs
{
  [LyrelogBridge screen:name attrs:attrs];
}

- (void)flush:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [LyrelogBridge flush:^{
    resolve(nil);
  }];
}

- (void)stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [LyrelogBridge stop:^{
    resolve(nil);
  }];
}

- (NSString *)getSessionId
{
  return [LyrelogBridge sessionID];
}

@end
