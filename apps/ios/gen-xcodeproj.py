#!/usr/bin/env python3
"""Generates Aktau.xcodeproj (app + WidgetKit extension) deterministically.

Run from apps/ios:  python3 gen-xcodeproj.py
Object ids are derived from names, so regenerating produces a stable diff.
"""
import hashlib
import os

ROOT = os.path.dirname(os.path.abspath(__file__))


def oid(*parts: str) -> str:
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:24].upper()


SHARED = sorted(f for f in os.listdir(os.path.join(ROOT, "Shared")) if f.endswith(".swift"))
TARGETS = {
    "Aktau": {"dir": "AktauApp", "sources": ["AktauApp.swift"], "type": "com.apple.product-type.application",
              "product": "Aktau.app", "ptype": "wrapper.application", "bundle": "kz.aktau.app", "resources": ["Assets.xcassets"]},
    "AktauWidgetExtension": {"dir": "AktauWidget", "sources": ["AktauWidget.swift"], "type": "com.apple.product-type.app-extension",
                             "product": "AktauWidgetExtension.appex", "ptype": "wrapper.app-extension", "bundle": "kz.aktau.app.widget"},
}

objs: list[str] = []


def add(o: str):
    objs.append(o)


files = {}  # path -> fileRef id
for f in SHARED:
    files[f"Shared/{f}"] = oid("file", "Shared", f)
for t in TARGETS.values():
    for f in t["sources"] + t.get("resources", []) + ["Info.plist", f"{t['dir']}.entitlements"]:
        files[f"{t['dir']}/{f}"] = oid("file", t["dir"], f)

def ftype(p: str) -> str:
    if p.endswith(".xcassets"):
        return "folder.assetcatalog"
    return "sourcecode.swift" if p.endswith(".swift") else "text.plist.xml" if p.endswith(".plist") else "text.plist.entitlements"

for p, i in files.items():
    add(f'\t\t{i} /* {os.path.basename(p)} */ = {{isa = PBXFileReference; lastKnownFileType = {ftype(p)}; path = {os.path.basename(p)}; sourceTree = "<group>"; }};')

for name, t in TARGETS.items():
    t["productRef"] = oid("product", name)
    add(f'\t\t{t["productRef"]} /* {t["product"]} */ = {{isa = PBXFileReference; explicitFileType = {t["ptype"]}; includeInIndex = 0; path = {t["product"]}; sourceTree = BUILT_PRODUCTS_DIR; }};')

# Build files
for name, t in TARGETS.items():
    t["buildFiles"] = []
    for src in [f"Shared/{f}" for f in SHARED] + [f"{t['dir']}/{s}" for s in t["sources"]]:
        bid = oid("build", name, src)
        t["buildFiles"].append(bid)
        add(f'\t\t{bid} /* {os.path.basename(src)} in Sources */ = {{isa = PBXBuildFile; fileRef = {files[src]} /* {os.path.basename(src)} */; }};')
# Resources (the app icon's asset catalog, built by scripts/brand-assets.py)
for name, t in TARGETS.items():
    t["resourceFiles"] = []
    for res in [f"{t['dir']}/{r}" for r in t.get("resources", [])]:
        bid = oid("build", name, res)
        t["resourceFiles"].append(bid)
        add(f'\t\t{bid} /* {os.path.basename(res)} in Resources */ = {{isa = PBXBuildFile; fileRef = {files[res]} /* {os.path.basename(res)} */; }};')
embed_bf = oid("build", "Aktau", "embed-widget")
add(f'\t\t{embed_bf} /* AktauWidgetExtension.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {TARGETS["AktauWidgetExtension"]["productRef"]} /* AktauWidgetExtension.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};')

# Groups
main_group, products_group = oid("group", "main"), oid("group", "products")
groups = {"Shared": [f"Shared/{f}" for f in SHARED]}
for t in TARGETS.values():
    groups[t["dir"]] = [f"{t['dir']}/{f}" for f in t["sources"] + t.get("resources", []) + ["Info.plist", f"{t['dir']}.entitlements"]]
for g, members in groups.items():
    children = "".join(f"\n\t\t\t\t{files[m]} /* {os.path.basename(m)} */," for m in members)
    add(f'\t\t{oid("group", g)} /* {g} */ = {{isa = PBXGroup; children = ({children}\n\t\t\t); path = {g}; sourceTree = "<group>"; }};')
prod_children = "".join(f'\n\t\t\t\t{t["productRef"]} /* {t["product"]} */,' for t in TARGETS.values())
add(f'\t\t{products_group} /* Products */ = {{isa = PBXGroup; children = ({prod_children}\n\t\t\t); name = Products; sourceTree = "<group>"; }};')
main_children = "".join(f'\n\t\t\t\t{oid("group", g)} /* {g} */,' for g in groups) + f"\n\t\t\t\t{products_group} /* Products */,"
add(f'\t\t{main_group} = {{isa = PBXGroup; children = ({main_children}\n\t\t\t); sourceTree = "<group>"; }};')

# Build phases, targets, configs
project = oid("project")
proxy, dep = oid("proxy", "widget"), oid("dependency", "widget")
add(f'\t\t{proxy} /* PBXContainerItemProxy */ = {{isa = PBXContainerItemProxy; containerPortal = {project} /* Project object */; proxyType = 1; remoteGlobalIDString = {oid("target", "AktauWidgetExtension")}; remoteInfo = AktauWidgetExtension; }};')
add(f'\t\t{dep} /* PBXTargetDependency */ = {{isa = PBXTargetDependency; target = {oid("target", "AktauWidgetExtension")} /* AktauWidgetExtension */; targetProxy = {proxy} /* PBXContainerItemProxy */; }};')

COMMON = {
    "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "17.0", "TARGETED_DEVICE_FAMILY": "1", "SDKROOT": "iphoneos",
    "CODE_SIGN_STYLE": "Automatic", "CURRENT_PROJECT_VERSION": "1", "MARKETING_VERSION": "0.1.0", "SWIFT_EMIT_LOC_STRINGS": "YES",
}

def settings_block(d: dict) -> str:
    return "".join(f'\n\t\t\t\t{k} = {v if isinstance(v, str) and (v.replace(".", "").replace("_", "").isalnum()) else chr(34) + v + chr(34)};' for k, v in sorted(d.items()))

config_lists = {}
for name, t in TARGETS.items():
    tid = oid("target", name)
    src_phase, fw_phase, res_phase = oid("phase", name, "sources"), oid("phase", name, "frameworks"), oid("phase", name, "resources")
    bf = "".join(f"\n\t\t\t\t{b}," for b in t["buildFiles"])
    add(f'\t\t{src_phase} /* Sources */ = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({bf}\n\t\t\t); runOnlyForDeploymentPostprocessing = 0; }};')
    add(f'\t\t{fw_phase} /* Frameworks */ = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (\n\t\t\t); runOnlyForDeploymentPostprocessing = 0; }};')
    rf = "".join(f"\n\t\t\t\t{b}," for b in t["resourceFiles"])
    add(f'\t\t{res_phase} /* Resources */ = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({rf}\n\t\t\t); runOnlyForDeploymentPostprocessing = 0; }};')
    phases = [src_phase, fw_phase, res_phase]
    deps = ""
    if name == "Aktau":
        embed = oid("phase", name, "embed")
        add(f'\t\t{embed} /* Embed Foundation Extensions */ = {{isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = (\n\t\t\t\t{embed_bf} /* AktauWidgetExtension.appex in Embed Foundation Extensions */,\n\t\t\t); name = "Embed Foundation Extensions"; runOnlyForDeploymentPostprocessing = 0; }};')
        phases.append(embed)
        deps = f"\n\t\t\t\t{dep} /* PBXTargetDependency */,"
    configs = []
    for conf in ("Debug", "Release"):
        cid = oid("config", name, conf)
        configs.append(cid)
        s = dict(COMMON)
        s.update({
            "PRODUCT_BUNDLE_IDENTIFIER": t["bundle"], "PRODUCT_NAME": "$(TARGET_NAME)", "INFOPLIST_FILE": f"{t['dir']}/Info.plist",
            "CODE_SIGN_ENTITLEMENTS": f"{t['dir']}/{t['dir']}.entitlements", "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if conf == "Debug" else "-O",
        })
        if name == "Aktau":
            s.update({"LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks", "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon"})
        else:
            s.update({"LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks", "SKIP_INSTALL": "YES", "APPLICATION_EXTENSION_API_ONLY": "YES"})
        add(f'\t\t{cid} /* {conf} */ = {{isa = XCBuildConfiguration; buildSettings = {{{settings_block(s)}\n\t\t\t}}; name = {conf}; }};')
    cl = oid("configlist", name)
    config_lists[name] = cl
    add(f'\t\t{cl} /* Build configuration list for PBXNativeTarget "{name}" */ = {{isa = XCConfigurationList; buildConfigurations = (\n\t\t\t\t{configs[0]} /* Debug */,\n\t\t\t\t{configs[1]} /* Release */,\n\t\t\t); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};')
    ph = "".join(f"\n\t\t\t\t{p}," for p in phases)
    add(f'\t\t{tid} /* {name} */ = {{isa = PBXNativeTarget; buildConfigurationList = {cl}; buildPhases = ({ph}\n\t\t\t); buildRules = (\n\t\t\t); dependencies = ({deps}\n\t\t\t); name = {name}; productName = {name}; productReference = {t["productRef"]} /* {t["product"]} */; productType = "{t["type"]}"; }};')

proj_configs = []
for conf in ("Debug", "Release"):
    cid = oid("config", "project", conf)
    proj_configs.append(cid)
    s = {"ALWAYS_SEARCH_USER_PATHS": "NO", "CLANG_ENABLE_MODULES": "YES", "ENABLE_STRICT_OBJC_MSGSEND": "YES", "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
         "SDKROOT": "iphoneos", "SWIFT_COMPILATION_MODE": "singlefile" if conf == "Debug" else "wholemodule",
         "DEBUG_INFORMATION_FORMAT": "dwarf" if conf == "Debug" else "dwarf-with-dsym", "ONLY_ACTIVE_ARCH": "YES" if conf == "Debug" else "NO",
         "ENABLE_TESTABILITY": "YES" if conf == "Debug" else "NO", "GCC_OPTIMIZATION_LEVEL": "0" if conf == "Debug" else "s"}
    add(f'\t\t{cid} /* {conf} */ = {{isa = XCBuildConfiguration; buildSettings = {{{settings_block(s)}\n\t\t\t}}; name = {conf}; }};')
proj_cl = oid("configlist", "project")
add(f'\t\t{proj_cl} /* Build configuration list for PBXProject "Aktau" */ = {{isa = XCConfigurationList; buildConfigurations = (\n\t\t\t\t{proj_configs[0]} /* Debug */,\n\t\t\t\t{proj_configs[1]} /* Release */,\n\t\t\t); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};')
targets_list = "".join(f'\n\t\t\t\t{oid("target", n)} /* {n} */,' for n in TARGETS)
add(f'\t\t{project} /* Project object */ = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 2600; LastUpgradeCheck = 2600; }}; buildConfigurationList = {proj_cl}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base, ru, kk, ); mainGroup = {main_group}; productRefGroup = {products_group} /* Products */; projectDirPath = ""; projectRoot = ""; targets = ({targets_list}\n\t\t\t); }};')

out = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n" + "\n".join(objs) + f"\n\t}};\n\trootObject = {project} /* Project object */;\n}}\n"
os.makedirs(os.path.join(ROOT, "Aktau.xcodeproj"), exist_ok=True)
with open(os.path.join(ROOT, "Aktau.xcodeproj", "project.pbxproj"), "w") as fh:
    fh.write(out)
print("wrote Aktau.xcodeproj/project.pbxproj", len(objs), "objects")
