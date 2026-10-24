import { CheckDot, Connector, Cursor, Eyebrow, Heading, Nw, Spark, dot } from '../parts'

// The one start line every Run Edit Run page shows, and the alternative for people who already have Node.
const START = 'curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-locket'
const ALTERNATIVE = 'Already have Node 22 or later? npx -y @runeditrun/rer dev just-every/run-locket'

/** A command that wraps only between words, keeping the installer's `install.sh | sh` together. */
function words(line: string) {
  return line.split(/(\S*install\.sh \| sh|\S+)/).map((part, index) => {
    const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
    if (pipe) return <span key={index}><span className="nw">{pipe[1]}</span><wbr /><span className="nw">{pipe[2]}</span></span>
    return part.trim() ? <span key={index} className="nw">{part}</span> : part
  })
}

const tiles: [string, string][] = [['50', 'sampled by Priya'], ['1,198', 'confirmed in bulk'], ['73', 'confirmed one by one'], ['612', 'auto-renewing, rolled forward']]

/** 12, moving in: Fieldstone's Ironclad export, Northwind's record shown twice, and the one line that starts Locket. */
export function MovingIn() {
  return (
    <section className="sec movein" aria-labelledby="movein-title">
      <div className="stage movein-stage">
        <header className="sec-head movein-head">
          <Eyebrow stage="Moving in" when="Thu Aug 27 – Tue Sep 1" />
          <Heading id="movein-title" top="1,271 agreements," bottom="every deadline live." />
        </header>
        <p className="lede movein-lede">Fieldstone's Ironclad records came over with their files; Priya checked fifty renewal terms and every deadline was live Tuesday.</p>

        <div className="card strip">
          <p className="mini-label">Renewal terms confirmed{dot}1,271 agreements from Ironclad</p>
          <ul>
            {tiles.map(([value, label]) => <li key={label}><b>{value}</b><span>{label}</span></li>)}
          </ul>
          <Cursor who="priya" style={{ left: 198, top: 112 }} />
        </div>

        <div className="card ironclad">
          <p className="mini-label">Ironclad record{dot}exported <Nw>Thu Aug 27</Nw></p>
          <p className="rec-title">Northwind Hosting{dot}Supplier Agreement</p>
          <dl className="kv">
            <div><dt>Record ID</dt><dd><Nw>IC-20418</Nw></dd></div>
            <div><dt>Properties</dt><dd>38</dd></div>
            <div><dt>Attachments</dt><dd className="files"><Nw>Northwind_MSA_2023.pdf</Nw><span className="files-sep">{dot}</span><Nw>Amendment_2.pdf</Nw></dd></div>
            <div><dt>Linked records</dt><dd>Amendment 2</dd></div>
            <div><dt>Renewal</dt><dd>Auto-renew{dot}60 days</dd></div>
          </dl>
        </div>
        <Connector className="movein-arrow" box="0 0 120 10" d="M2 5H116" />

        <div className="card locket-rec">
          <p className="mini-label">Locket record</p>
          <p className="rec-title">Northwind Hosting{dot}Supplier MSA</p>
          <p className="rec-sub">$96,000/yr{dot}from Amendment 2</p>
          <ul>
            <li><span>Ironclad ID <Nw>IC-20418</Nw>{dot}searchable</span><CheckDot tone="soft" /></li>
            <li>38 properties mapped<CheckDot tone="soft" /></li>
            <li><span>2 files kept byte-for-byte{dot}SHA-256</span><CheckDot tone="soft" /></li>
            <li>Amendment 2 linked as child<CheckDot tone="soft" /></li>
            <li><span>§11.2{dot}60 days' notice{dot}confirmed by Priya</span><CheckDot tone="soft" /></li>
            <li><span>60-day reminder{dot}<Nw>Mon Sep 14, 9:00 am</Nw>{dot}scheduled</span><CheckDot tone="soft" /></li>
          </ul>
        </div>

        <div className="terminal" role="group" aria-label="Start Locket on your computer">
          <p className="term-lights" aria-hidden="true"><i /><i /><i /></p>
          <pre><code><span className="term-prompt" aria-hidden="true">$ </span>{words(START)}{'\n'}<span className="term-note"># {words(ALTERNATIVE)}</span></code></pre>
        </div>
        <Spark style={{ left: 798, top: 576 }} turn={-20} />
        <Spark style={{ left: 1464, top: 856 }} turn={30} />
      </div>
    </section>
  )
}
