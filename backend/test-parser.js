const { parseInstruction } = require('./src/parser/parseInstruction');

// Example MCP tools similar to what we'd get from MCP server
const mcpTools = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }
      },
      required: ['url']
    }
  },
  {
    name: 'browser_screen_click',
    description: 'Click on an element',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string' }
      },
      required: ['element']
    }
  }
];

async function testParse() {
  console.log('Testing parser with complex instruction...');
  const instruction = 'go to https://coffee-cart.app/ and click item Espresso 2 times then click Cart';
  
  try {
    const result = await parseInstruction(instruction, mcpTools);
    console.log('RESULT:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  }
}

testParse(); 