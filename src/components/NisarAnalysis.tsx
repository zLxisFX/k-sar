import comparison from "@data/nasa/nisar/comparison/manifest.json";
import { aggregateHistogram } from "@/domain/nisar-browse";
import type { BrowseSample, NisarDisplay } from "@/domain/nisar-browse";

export default function NisarAnalysis({
  before,
  after,
  display,
  onDisplay,
}: {
  before: BrowseSample | null;
  after: BrowseSample | null;
  display: NisarDisplay;
  onDisplay: (display: NisarDisplay) => void;
}) {
  const statistics = comparison.difference.statistics.displayBrightness;
  const bins = aggregateHistogram(statistics.histogram.counts, 2).filter(
    (bin) => bin.high >= statistics.min && bin.low <= statistics.max,
  );
  const peak = Math.max(1, ...bins.map((bin) => bin.count));
  const left = bins[0].low - 0.5,
    right = bins.at(-1)!.high + 0.5;
  const zero = (512 * -left) / (right - left);
  return (
    <section className="nisar-analysis" aria-label="NISAR common-area analysis">
      <div className="nisar-analysis-heading">
        <div>
          <h2>NISAR L2 GCOV browse comparison</h2>
          <p>21 Oct / 2 Nov 2026 · ascending track 140, frame 009</p>
        </div>
        <div className="nisar-display-buttons" aria-label="NISAR display">
          <button
            aria-pressed={display === "pair"}
            onClick={() => onDisplay("pair")}
          >
            Swipe pair
          </button>
          <button
            aria-pressed={display === "difference"}
            onClick={() => onDisplay("difference")}
          >
            Display difference
          </button>
        </div>
      </div>
      <div className="nisar-analysis-grid">
        <div>
          <h3>Selected common cell</h3>
          <dl className="nisar-cell-values">
            <div>
              <dt>21 Oct · RGB</dt>
              <dd>{before?.rgb.join(" / ") ?? "No common data"}</dd>
            </div>
            <div>
              <dt>2 Nov · RGB</dt>
              <dd>{after?.rgb.join(" / ") ?? "No common data"}</dd>
            </div>
            <div>
              <dt>Display brightness</dt>
              <dd>
                {before && after
                  ? `${before.brightness} → ${after.brightness} DN`
                  : "No common data"}
              </dd>
            </div>
            <div>
              <dt>2 Nov minus 21 Oct</dt>
              <dd>
                {before && after
                  ? `${after.brightness - before.brightness > 0 ? "+" : ""}${after.brightness - before.brightness} DN`
                  : "No common data"}
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h3>Common-area display change</h3>
          <svg
            className="nisar-histogram"
            viewBox="0 0 512 106"
            role="img"
            aria-label={`Histogram of display-brightness change across ${comparison.commonMask.validPixels} common cells`}
          >
            {bins.map((bin, i) => (
              <rect
                key={bin.low}
                x={(i * 512) / bins.length}
                y={88 - (78 * bin.count) / peak}
                width={512 / bins.length - 1}
                height={(78 * bin.count) / peak}
                fill={bin.high < 0 ? "#376f84" : "#af7139"}
              >
                <title>{`${bin.low} to ${bin.high} DN: ${bin.count} cells`}</title>
              </rect>
            ))}
            <line
              x1={zero}
              x2={zero}
              y1="4"
              y2="90"
              stroke="#52635b"
              strokeDasharray="3 3"
            />
            <text x="0" y="104">
              {bins[0].low}
            </text>
            <text x={zero} y="104" textAnchor="middle">
              0
            </text>
            <text x="511" y="104" textAnchor="end">
              +{bins.at(-1)!.high} DN
            </text>
          </svg>
          <p className="nisar-statistics">
            {comparison.commonMask.validPixels.toLocaleString()} common cells ·
            mean {statistics.mean.toFixed(2)} DN · median {statistics.median} DN
          </p>
        </div>
      </div>
      <p className="nisar-limits">
        Provider KML georeferencing · 200 m projected grid · nearest-neighbor
        sampling. RGB browse stretches are scene-dependent; differences measure
        display codes, not calibrated backscatter or physical surface change.
        Positional accuracy is unvalidated.
      </p>
      <a
        className="nisar-method-link"
        href="/data/nasa/nisar/comparison/manifest.json"
        target="_blank"
        rel="noreferrer"
      >
        Grid, common mask, histogram and source hashes
      </a>
    </section>
  );
}
