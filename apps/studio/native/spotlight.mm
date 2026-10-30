#import <CoreSpotlight/CoreSpotlight.h>
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <string>
#include <vector>

struct IndexWork {
    napi_async_work work;
    napi_deferred deferred;
    CSSearchableIndex* index;
    std::string json;
    std::string error;
};

static void Execute(napi_env env, void* data) {
    auto* work = static_cast<IndexWork*>(data);
    @autoreleasepool {
        NSData* json = [NSData dataWithBytes:work->json.data() length:work->json.size()];
        NSError* parseError = nil;
        id entries = [NSJSONSerialization JSONObjectWithData:json options:0 error:&parseError];
        if (![entries isKindOfClass:[NSArray class]]) {
            work->error = "Spotlight entries must be a JSON array.";
            return;
        }

        NSString* domain = @"com.wordpress.studio.actions";
        NSMutableArray<CSSearchableItem*>* items = [NSMutableArray array];
        for (id entry in entries) {
            if (![entry isKindOfClass:[NSDictionary class]] ||
                ![entry[@"url"] isKindOfClass:[NSString class]] ||
                ![entry[@"title"] isKindOfClass:[NSString class]] ||
                ![entry[@"description"] isKindOfClass:[NSString class]] ||
                ![entry[@"keywords"] isKindOfClass:[NSArray class]]) {
                work->error = "Invalid Spotlight entry.";
                return;
            }
            for (id keyword in entry[@"keywords"]) {
                if (![keyword isKindOfClass:[NSString class]]) {
                    work->error = "Spotlight keywords must be strings.";
                    return;
                }
            }
            CSSearchableItemAttributeSet* attributes =
                [[CSSearchableItemAttributeSet alloc] initWithItemContentType:@"public.item"];
            attributes.title = entry[@"title"];
            attributes.displayName = entry[@"title"];
            attributes.contentDescription = entry[@"description"];
            attributes.keywords = entry[@"keywords"];
            CSSearchableItem* item = [[CSSearchableItem alloc]
                initWithUniqueIdentifier:entry[@"url"] domainIdentifier:domain attributeSet:attributes];
            item.expirationDate = [NSDate distantFuture];
            [items addObject:item];
        }

        CSSearchableIndex* index = work->index;
        dispatch_semaphore_t finished = dispatch_semaphore_create(0);
        __block NSError* indexError = nil;
        [index deleteSearchableItemsWithDomainIdentifiers:@[domain] completionHandler:^(NSError* error) {
            if (error) {
                indexError = error;
                dispatch_semaphore_signal(finished);
                return;
            }
            [index indexSearchableItems:items completionHandler:^(NSError* error) {
                indexError = error;
                dispatch_semaphore_signal(finished);
            }];
        }];
        // Core Spotlight calls back on its own queue; only this Node worker waits.
        if (dispatch_semaphore_wait(finished, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC))) {
            work->error = "Spotlight indexing timed out.";
        } else if (indexError) {
            work->error = indexError.localizedDescription.UTF8String;
        }
    }
}

static void Complete(napi_env env, napi_status status, void* data) {
    auto* work = static_cast<IndexWork*>(data);
    if (status != napi_ok && work->error.empty()) {
        work->error = "Spotlight indexing was cancelled.";
    }
    if (work->error.empty()) {
        napi_value result;
        napi_get_undefined(env, &result);
        napi_resolve_deferred(env, work->deferred, result);
    } else {
        napi_value message, error;
        napi_create_string_utf8(env, work->error.c_str(), NAPI_AUTO_LENGTH, &message);
        napi_create_error(env, nullptr, message, &error);
        napi_reject_deferred(env, work->deferred, error);
    }
    napi_delete_async_work(env, work->work);
    delete work;
}

static napi_value ReplaceEntries(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    size_t length;
    if (argc != 1 || napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) != napi_ok) {
        napi_throw_type_error(env, nullptr, "Expected Spotlight entries as a JSON string.");
        return nullptr;
    }
    std::vector<char> json(length + 1);
    napi_get_value_string_utf8(env, argv[0], json.data(), json.size(), &length);
    auto* work = new IndexWork{};
    work->json.assign(json.data(), length);
    work->index = [CSSearchableIndex defaultSearchableIndex];
    napi_value promise, name;
    napi_create_promise(env, &work->deferred, &promise);
    napi_create_string_utf8(env, "studio:spotlight", NAPI_AUTO_LENGTH, &name);
    if (napi_create_async_work(env, nullptr, name, Execute, Complete, work, &work->work) != napi_ok) {
        delete work;
        napi_throw_error(env, nullptr, "Could not create the Spotlight indexing task.");
        return nullptr;
    }
    if (napi_queue_async_work(env, work->work) != napi_ok) {
        napi_delete_async_work(env, work->work);
        delete work;
        napi_throw_error(env, nullptr, "Could not queue the Spotlight indexing task.");
        return nullptr;
    }
    return promise;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_value replace;
    napi_create_function(env, "replaceEntries", NAPI_AUTO_LENGTH, ReplaceEntries, nullptr, &replace);
    napi_set_named_property(env, exports, "replaceEntries", replace);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
