export default function UnsupportedBrowserPage({ support }) {
  return (
    <main className="unsupported narrow" role="alert">
      <h1>Your browser is not supported</h1>
      <p>
        This exam needs features your browser does not have: {support.missing.filter((m) => m !== 'Fullscreen API').join(', ')}.
        Detected: {support.browser.name} {support.browser.version}.
      </p>
      <p>Please open this page in the latest Chrome, Edge, Firefox or Safari over HTTPS, then try again.</p>
    </main>
  );
}
