// 블로트웨어(기본 설치 앱) 목록. pattern 은 Appx 패키지 Name 에 대한 와일드카드
// Microsoft Store, Xbox(게임 실행에 필요), 사진, 계산기, 메모장, 터미널 등 필수 앱은 목록에 넣지 않는다.
const BLOAT = [
  { pattern: 'Microsoft.BingNews', name: '뉴스' },
  { pattern: 'Microsoft.BingWeather', name: '날씨' },
  { pattern: 'Microsoft.BingSearch', name: 'Bing 검색' },
  { pattern: 'Microsoft.GetHelp', name: '도움 받기' },
  { pattern: 'Microsoft.Getstarted', name: '팁' },
  { pattern: 'Microsoft.MicrosoftSolitaireCollection', name: 'Solitaire Collection' },
  { pattern: 'Microsoft.People', name: '사람' },
  { pattern: 'Microsoft.WindowsFeedbackHub', name: '피드백 허브' },
  { pattern: 'Microsoft.WindowsMaps', name: '지도' },
  { pattern: 'Microsoft.ZuneMusic', name: '미디어 플레이어 / Groove 음악' },
  { pattern: 'Microsoft.ZuneVideo', name: '영화 및 TV' },
  { pattern: 'Microsoft.MicrosoftOfficeHub', name: 'Microsoft 365 (Office 허브)' },
  { pattern: 'Microsoft.SkypeApp', name: 'Skype' },
  { pattern: 'Microsoft.Todos', name: 'Microsoft To Do' },
  { pattern: 'Microsoft.PowerAutomateDesktop', name: 'Power Automate' },
  { pattern: 'Clipchamp.Clipchamp', name: 'Clipchamp 동영상 편집기' },
  { pattern: 'MicrosoftTeams', name: 'Teams (개인용)' },
  { pattern: 'MSTeams', name: 'Teams' },
  { pattern: 'Microsoft.549981C3F5F10', name: 'Cortana' },
  { pattern: 'Microsoft.WindowsAlarms', name: '알람 및 시계' },
  { pattern: 'Microsoft.WindowsSoundRecorder', name: '녹음기' },
  { pattern: 'Microsoft.Microsoft3DViewer', name: '3D 뷰어' },
  { pattern: 'Microsoft.MixedReality.Portal', name: '혼합 현실 포털' },
  { pattern: 'Microsoft.Wallet', name: 'Wallet' },
  { pattern: 'Microsoft.OutlookForWindows', name: '새 Outlook' },
  { pattern: 'Microsoft.Windows.DevHome', name: 'Dev Home' },
  { pattern: 'Microsoft.YourPhone', name: '휴대폰과 연결' },
  { pattern: 'Microsoft.MicrosoftStickyNotes', name: '스티커 메모' },
  { pattern: 'Microsoft.Copilot', name: 'Copilot 앱' },
  { pattern: 'MicrosoftCorporationII.QuickAssist', name: '빠른 지원' },
  { pattern: 'Microsoft.GamingApp', name: 'Xbox 앱 (Game Pass 미사용 시)', caution: true },
  { pattern: 'Microsoft.XboxApp', name: 'Xbox 콘솔 컴패니언' },
  { pattern: '*CandyCrush*', name: 'Candy Crush' },
  { pattern: '*Disney*', name: 'Disney+' },
  { pattern: '*Spotify*', name: 'Spotify' },
  { pattern: '*Facebook*', name: 'Facebook' },
  { pattern: '*Instagram*', name: 'Instagram' },
  { pattern: '*TikTok*', name: 'TikTok' },
  { pattern: '*Netflix*', name: 'Netflix' },
  { pattern: '*LinkedIn*', name: 'LinkedIn' },
  { pattern: '*AmazonPrimeVideo*', name: 'Prime Video' },
  { pattern: '*McAfee*', name: 'McAfee (체험판)' },
];

const BLOAT_LIST = String.raw`
$pk = @(Get-AppxPackage -ErrorAction SilentlyContinue)
$out = @()
foreach ($b in @($A.list)) {
  foreach ($p in @($pk | Where-Object { $_.Name -like $b.pattern -and -not $_.IsFramework -and -not $_.NonRemovable })) {
    $out += ,@{ pattern = $b.pattern; name = $b.name; caution = [bool]$b.caution; pkg = $p.Name; full = $p.PackageFullName; ver = [string]$p.Version }
  }
}
Emit @{ items = $out }
`;

const BLOAT_REMOVE = String.raw`
$out = @()
foreach ($f in @($A.list)) {
  try { Remove-AppxPackage -Package $f -ErrorAction Stop; $out += ,@{ full = $f; ok = $true } }
  catch { $out += ,@{ full = $f; ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

module.exports = { BLOAT, BLOAT_LIST, BLOAT_REMOVE };
