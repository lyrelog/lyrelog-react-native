require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# The Lyrelog Swift SDK, as a Swift package (React Native's `spm_dependency`): the git URL below,
# from 1.1.1 up to the next minor version (1.1 catches crashes in the app's process; 1.1.1 lets a
# fatal JavaScript error say it's already reported). To work on both at once, LYRELOG_SWIFT_PATH points at a
# local checkout instead.
LYRELOG_SWIFT_URL = "https://github.com/lyrelog/lyrelog-swift.git"
lyrelog_swift_local = ENV["LYRELOG_SWIFT_PATH"]

Pod::Spec.new do |s|
  s.name         = "LyrelogReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = { "Lyrelog" => "hello@lyrelog.com" }
  s.platforms    = { :ios => "16.0" }
  s.source       = { :git => "https://github.com/lyrelog/lyrelog-react-native.git", :tag => s.version.to_s }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.private_header_files = "ios/**/*.h"
  s.swift_version = "6.0"

  install_modules_dependencies(s)

  if lyrelog_swift_local && File.exist?(File.join(lyrelog_swift_local, "Package.swift"))
    spm_dependency(s, url: File.expand_path(lyrelog_swift_local), requirement: {}, products: ["Lyrelog"])
  else
    spm_dependency(s,
      url: LYRELOG_SWIFT_URL,
      requirement: { kind: "upToNextMinorVersion", minimumVersion: "1.1.1" },
      products: ["Lyrelog"])
  end
end
