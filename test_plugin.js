
const quintham = require('./quintham.js');

// Mock the MeshCentral parent object
const parent = {
    webserver: {
        wsagents: {
            'node123': {
                send: (msg) => console.log('Agent Send:', msg)
            }
        }
    },
    wss: {
        clients: [
            { send: (msg) => console.log('Client Send:', msg) }
        ]
    },
    itemEventBus: {
        on: (event, callback) => {
            console.log(`Registered event listener for: ${event}`);
            // Keep reference if we want to trigger it later
            if (event === 'agentconsole') {
                global.agentConsoleCallback = callback;
            }
        }
    }
};

console.log('--- Initializing Plugin ---');
const plugin = quintham.quintham(parent);

console.log('--- Plugin Exports ---');
console.log(plugin.exports);

console.log('--- Testing onDeviceRefreshEnd ---');
const htmlContent = plugin.onDeviceRefreshEnd('node123', 3, {}, { _id: 'node123' }, {}, {}, {});
console.log('Generated HTML length:', htmlContent.length);
if (htmlContent.includes('Quintham Toolkit')) {
    console.log('PASS: HTML contains "Quintham Toolkit"');
} else {
    console.log('FAIL: HTML missing "Quintham Toolkit"');
}

console.log('--- Testing onMessage (findDb) ---');
const msgResult = plugin.onMessage({}, {}, {}, {
    action: 'plugin',
    plugin: 'quintham',
    method: 'findDb',
    nodeId: 'node123'
});
console.log('onMessage returned:', msgResult);

console.log('--- Testing Agent Console Response (findDb) ---');
if (global.agentConsoleCallback) {
    global.agentConsoleCallback({
        nodeid: 'node123',
        value: 'QUINTHAM_DB_PATH: C:\\Test\\database.db3'
    });
} else {
    console.log('FAIL: No agentconsole listener registered');
}

console.log('--- Test Complete ---');
