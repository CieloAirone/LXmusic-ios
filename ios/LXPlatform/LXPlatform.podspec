Pod::Spec.new do |s|
  s.name = 'LXPlatform'
  s.version = '1.0.0'
  s.summary = 'iOS platform adapters for the unofficial LX Music port'
  s.homepage = 'https://github.com/lyswhut/lx-music-mobile'
  s.license = { :type => 'Apache-2.0', :file => '../../LICENSE' }
  s.author = 'LX Music iOS contributors'
  s.platform = :ios, '15.0'
  # Development pod: Podfile's :path supplies the local sources.
  s.source = { :git => 'https://github.com/lyswhut/lx-music-mobile.git', :commit => 'cd37a979a5845f1220b306b374285f5d38329e8d' }
  s.source_files = '*.{h,m,mm}'
  s.resources = 'Resources/*'
  s.frameworks = 'AVFoundation', 'Security', 'JavaScriptCore', 'UIKit', 'UniformTypeIdentifiers'
  s.dependency 'React-Core'
end
