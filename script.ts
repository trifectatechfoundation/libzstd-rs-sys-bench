type Unit = 'MB' | 'ms' | 'sec';
type MemoryMetric = [number, 'MB'];
type TimeMetric = [number, 'ms'];

type Root = {
  commit_hash: string
  commit_timestamp: number
  timestamp: Timestamp
  arch: string
  os: string
  runner: string
  cpu_model: string
  bench_groups: {[key: string]: SingleBench[]},
};

type Timestamp = {
  secs_since_epoch: number
  nanos_since_epoch: number
};

type SingleBench = {
  cmd: string[]
  counters: Counters
};

type CounterName = "cycles" | "instructions" | "user-time" | "task-clock";

function counter_to_title(counter: CounterName) {
    switch (counter) {
        case "task-clock": { return "Wall Time (ms)"; }
        case "user-time": { return "Wall Time (ms)"; }
        case "cycles": { return "Cycles"; }
        case "instructions": { return "Instructions"; }
        default: { return "unknown"; }
    }
}

function counter_to_verb(counter: CounterName) {
    switch (counter) {
        case "task-clock": { return "faster"; }
        case "user-time": { return "faster"; }
        default: { return "better"; }
    }
}

type Counters = {
  [name in CounterName]: Counter
};

type Counter = {
  value: number
  variance: number | undefined
  repetitions: number | undefined
  unit: string
};

type Plots = {
    data: (Plotly.Data & { name: string })[];
    layout: Partial<Plotly.Layout>;
};

function parseQueryString(): [Date | null, Date | null] {
    let start: Date | null = null;
    let end: Date | null = null;
    if (location.search != '') {
        const params = location.search.substring(1).split('&');
        for (const param of params) {
            const [name, value] = param.split('=', 2);
            if (value === '') {
                continue;
            }
            if (name == 'start') {
                start = new Date(value);
            } else if (name == 'end') {
                end = new Date(value);
            }
        }
    }
    return [start, end];
}

function mapUnitToMax(unit: Unit): Unit {
    switch (unit) {
        case 'ms':
            return 'sec';
        default:
            return unit;
    }
}

function show_notification(html_text: string) {
    let notificationElem = document.getElementById('notification')!;
    notificationElem.innerHTML = html_text;
    notificationElem.classList.remove('hidden');
    setTimeout(() => {
        notificationElem.classList.add('hidden');
    }, 3000);
}

function results_over_time(
    title: string,
    lines: Root[],
    group: string,
    keys: string[],
    get_key: (cmd: string[]) => string,
    key_to_name: (key: string) => string,
    counter: CounterName,
): Plots {
    let plot: Plots = {
        data: [],
        layout: {
            title,
            xaxis: {
                title: "Benchmark Index",
                tickformat: 'd', // only integers
            },
            yaxis: {
                title: counter_to_title(counter),
                rangemode: "tozero",
            },
            height: 700,
            width: Math.min(1200, window.innerWidth - 30),
            margin: {
                l: 50,
                r: 20,
                b: 100,
                t: 100,
                pad: 4,
            },
            legend: {
                orientation: window.innerWidth < 700 ? "h" : "v",
            },
        },
    };

    let unzipped: {[level: string]: {x: [], y: number[], error: number[], sha: string[]}} = {};

    for (let i in lines) {
        let line = lines[i];
        for (let run of line.bench_groups[group]) {
            const key = get_key(run.cmd);

            if (!unzipped[key]) {
                unzipped[key] = { x: [], y: [], error: [], sha: [] };
            }

            unzipped[key].y[i] = run.counters[counter].value;
            unzipped[key].error[i] = Math.sqrt(run.counters[counter].variance ?? 0);
            unzipped[key].sha[i] = line.commit_hash;
        }
    }

    for (let key of keys) {
        if (!unzipped[key]) {
            continue;
        }

        plot.data.push({
            y: unzipped[key].y,
            error_y: {
                type: "data",
                array: unzipped[key].error,
                visible: true,
            },
            text: unzipped[key].sha,
            name: key_to_name(key),
            hovertemplate: `%{y} %{text}`
        });
    }

    return plot;
}

function compare_impls(
    title: string,
    from_name: string,
    from: SingleBench[],
    to_name: string,
    to: SingleBench[],
    xaxis_title: string,
    get_xval: (cmd: string[]) => number | string,
    counter: CounterName,
    range: number[],
): Plots {


    let plot: Plots & { data: { x: string[] }[] } = {
        data: [],
        layout: {
            title,
            xaxis: {
                title: xaxis_title,
                range: range,
            },
            yaxis: {
                title: counter_to_title(counter),
                rangemode: "tozero",
            },
            height: 700,
            width: Math.min(1200, window.innerWidth - 30),
            margin: {
                l: 50,
                r: 20,
                b: 100,
                t: 100,
                pad: 4,
            },
            legend: {
                orientation: window.innerWidth < 700 ? "h" : "v",
            },
        },
    };

    plot.data.push({
        x: from.map((result) => get_xval(result.cmd)),
        y: from.map((result) => result.counters[counter].value),
        error_y: {
            type: "data",
            array: from.map((result) => Math.sqrt(result.counters[counter].variance ?? 0)),
            visible: true,
        },
        name: from_name,
    });
    if (typeof plot.data[0].x[0] == "string") {
        plot.data[plot.data.length - 1].type = "bar";
    }

    plot.data.push({
        x: to.map((result) => get_xval(result.cmd)),
        y: to.map((result) => result.counters[counter].value),
        error_y: {
            type: "data",
            array: to.map((result) => Math.sqrt(result.counters[counter].variance ?? 0)),
            visible: true,
        },
        text: to.map((result, index) => {
            let vrs = result.counters[counter].value;
            let vng = from[index]?.counters[counter].value;

            return ((vng / vrs)).toFixed(2);
        }),
        name: to_name,
        hovertemplate: `%{y} (%{text}x ${counter_to_verb(counter)} than ${from_name})`
    });
    if (typeof plot.data[0].x[0] == "string") {
        plot.data[plot.data.length - 1].type = "bar";
    }

    return plot;
}

function compare_impls_barchart(
    title: string,
    from_name: string,
    from: SingleBench[],
    to_name: string,
    to: SingleBench[],
    xaxis_title: string,
    get_xval: (cmd: string[]) => number | string,
    counter: CounterName,
): Plots {
    let plot: Plots & { data: { x: string[] }[] } = {
        data: [],
        layout: {
            title,
            xaxis: {
                title: xaxis_title,
            },
            yaxis: {
                title: "Wall Time (ms)",
                rangemode: "tozero",
            },
            height: 700,
            width: Math.min(1200, window.innerWidth - 30),
            margin: {
                l: 50,
                r: 20,
                b: 100,
                t: 100,
                pad: 4,
            },
            legend: {
                orientation: window.innerWidth < 700 ? "h" : "v",
            },
        },
    };

    plot.data.push({
        x: from.map((result) => get_xval(result.cmd)),
        y: from.map((result) => result.counters[counter].value),
        error_y: {
            type: "data",
            array: from.map((result) => Math.sqrt(result.counters[counter].variance ?? 0)),
            visible: true,
        },
        name: from_name,
    });
    if (typeof plot.data[0].x[0] == "string") {
        plot.data[plot.data.length - 1].type = "bar";
    }

    plot.data.push({
        x: to.map((result) => get_xval(result.cmd)),
        y: to.map((result) => result.counters[counter].value),
        error_y: {
            type: "data",
            array: to.map((result) => Math.sqrt(result.counters[counter].variance ?? 0)),
            visible: true,
        },
        text: to.map((result, index) => {
            let vrs = result.counters[counter].value;
            let vng = from[index].counters[counter].value;

            return ((vng / vrs)).toFixed(2);
        }),
        name: to_name,
        hovertemplate: `%{y} (%{text}x faster than ${from_name})`
    });
    if (typeof plot.data[0].x[0] == "string") {
        plot.data[plot.data.length - 1].type = "bar";
    }

    return plot;
}

async function main() {
    await update('linux-x86', 'task-clock');
}

async function update(target: string, counter: CounterName) {
    let data_url = `https://raw.githubusercontent.com/trifectatechfoundation/libzstd-rs-sys-bench/main/metrics-${target}.json`

    const data = await (await fetch(data_url)).text();

    const entries: Root[] = data
        .split('\n')
        .filter((it) => it.length > 0)
        .map((it) => JSON.parse(it));

    render(data_url, entries, counter);
}

function render_plot(plot: Plots) {
    const bodyElement = document.getElementById('plots')!;

    // Render the plot
    const plotDiv = document.createElement(
        "div"
    ) as any as Plotly.PlotlyHTMLElement;

    Plotly.newPlot(plotDiv, plot.data, plot.layout);

    bodyElement.appendChild(plotDiv);
}

function render(data_url: string, entries: Root[], counter: CounterName) {
    const bodyElement = document.getElementById('plots')!;

    // clear the plots from the previous configuration
    while (bodyElement.firstChild) {
        bodyElement.removeChild(bodyElement.firstChild);
    }

    {
        const final = entries[entries.length - 1];
        const final_c = final.bench_groups["decompress-c"];
        const final_rs = final.bench_groups["decompress-rs"];


    {
        const final = entries[entries.length - 1];
        const final_c = final.bench_groups["decompress-c"];
        const final_rs = final.bench_groups["decompress-rs"];
        const plot = compare_impls_barchart(
            `c versus rs (decompression, ${counter}, on <a href="https://github.com/trifectatechfoundation/libzstd-rs-sys/commit/${final.commit_hash}">main</a>)`,
            "zstd-rs",
            final_c,
            "libzstd-rs-sys",
            final_rs,
            "File",
            (cmd) => cmd[2].split("/").reverse()[0],
            counter,
        );
        render_plot(plot);
    }

        //        {
        //            const plot = compare_impls(
        //                `c versus rs (decompression, ${counter}, on <a href="https://github.com/trifectatechfoundation/libzstd-rs-sys/commit/${final.commit_hash}">main</a>)`,
        //                "zstd-sys",
        //                final_c,
        //                "libzstd-rs-sys",
        //                final_rs,
        //                "Input Chunk Size (power of 2 bytes)",
        //                (cmd) => parseFloat(cmd[2]),
        //                counter,
        //                [5, 16],
        //            );
        //            render_plot(plot);
        //        }
    }

    {
        console.log(entries);
        const plot = results_over_time(
            "libzstd-rs-sys decompression",
            entries,
            "decompress-rs",
            ["silesia-small.tar"],
            (cmd) => cmd[2],
            (level) => `2^${level}`,
            counter,
        );
        render_plot(plot);
    }
}

main();
