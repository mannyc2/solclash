for await (const line of console) {
  const msg = JSON.parse(line);
  if (msg.type === "init") {
    console.log(JSON.stringify({ type: "ok", request_id: msg.request_id }));
  } else if (msg.type === "eval") {
    console.log(
      JSON.stringify({
        type: "result",
        request_id: msg.request_id,
        agent_id: msg.agent_id,
        status: "OK",
        output: {
          version: 1,
          action_type: 0,
          order_qty: "0",
          err_code: 7,
        },
      }),
    );
  } else if (msg.type === "shutdown") {
    console.log(JSON.stringify({ type: "ok", request_id: msg.request_id }));
    process.exit(0);
  }
}
