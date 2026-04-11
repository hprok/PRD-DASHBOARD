import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const startMarker = '{/* Modal Chi tiết */}';
const endMarker = '{/* Footer */}';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const originalModalBlock = content.substring(startIndex, endIndex);
const bodyStartIndex = originalModalBlock.indexOf('{/* Modal Body */}');
const footerStartIndex = originalModalBlock.indexOf('{/* Modal Footer */}');

let modalBodyContent = originalModalBlock.substring(bodyStartIndex, footerStartIndex);
modalBodyContent = modalBodyContent.replace(/selectedItem/g, 'panelItem');

const newModalContent = `        {/* Cascading Panels */}
        <AnimatePresence>
          {panelStack.length > 0 && (
            <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm overflow-hidden">
              {/* Overlay click to close all */}
              <div className="absolute inset-0" onClick={closeAllPanels} />
              
              {panelStack.map((panelItem, index) => {
                const isLast = index === panelStack.length - 1;
                const offsetRight = (panelStack.length - 1 - index) * 40;
                const zIndex = 50 + index;
                
                return (
                  <motion.div
                    key={\`\${panelItem.id || panelItem.name || index}-\${index}\`}
                    initial={{ x: '100%', opacity: 0, boxShadow: '-10px 0 30px rgba(0,0,0,0)' }}
                    animate={{ x: 0, opacity: 1, boxShadow: '-10px 0 30px rgba(0,0,0,0.1)' }}
                    exit={{ x: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                    style={{ 
                      right: \`\${offsetRight}px\`, 
                      zIndex,
                      width: 'min(800px, 90vw)'
                    }}
                    className={\`absolute top-0 bottom-0 h-full border-l shadow-2xl flex flex-col \${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}\`}
                  >
                    {/* Panel Header */}
                    <div className={\`flex items-center justify-between p-4 border-b shrink-0 \${darkMode ? 'border-gray-700 bg-slate-800/50' : 'border-gray-200 bg-slate-50'}\`}>
                      <div className="flex items-center gap-3 overflow-hidden">
                        {(panelItem.id || panelItem.module || panelItem.group) && (
                          <span className="px-2 py-1 rounded bg-indigo-500 text-white text-xs font-bold font-mono shrink-0">
                            {panelItem.id || panelItem.module || panelItem.group || 'INFO'}
                          </span>
                        )}
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                          {panelItem.name || panelItem.endpoint || panelItem.title || panelItem.object || panelItem.summary || panelItem.field}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button 
                          onClick={() => copyToClipboard(JSON.stringify(panelItem, null, 2))}
                          className={\`p-2 rounded-full transition-all \${darkMode ? 'hover:bg-gray-700 text-gray-100' : 'hover:bg-gray-200 text-gray-900'}\`}
                          title="Copy JSON Data"
                        >
                          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button 
                          onClick={() => closePanel(index)}
                          className={\`p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors \${darkMode ? 'text-gray-100' : 'text-gray-900'}\`}
                        >
                          <Zap className="w-5 h-5 rotate-45" />
                        </button>
                      </div>
                    </div>

`;

const finalReplacement = newModalContent + modalBodyContent + `
                  </motion.div>
                );
              })}
            </div>
          )}
        </AnimatePresence>

        `;

content = content.substring(0, startIndex) + finalReplacement + content.substring(endIndex);
fs.writeFileSync('src/App.tsx', content);
console.log('Replacement successful');
