import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const startMarker = '{/* Cascading Panels */}';
const endMarker = '{/* Footer */}';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const originalPanelBlock = content.substring(startIndex, endIndex);
const bodyStartIndex = originalPanelBlock.indexOf('{/* Panel Body */}');
const footerStartIndex = originalPanelBlock.indexOf('</motion.div>');

let panelBodyContent = originalPanelBlock.substring(bodyStartIndex, footerStartIndex);

const newPanelContent = `        {/* Cascading Panels */}
        <AnimatePresence>
          {panelStack.length > 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex bg-black/20 backdrop-blur-sm overflow-x-auto overflow-y-hidden custom-scrollbar"
            >
              {/* Overlay click to close all */}
              <div className="fixed inset-0" onClick={closeAllPanels} />
              
              <div className="relative flex h-full pointer-events-none items-stretch min-w-full">
                <AnimatePresence mode="popLayout">
                  {panelStack.map((panelItem, index) => {
                    return (
                      <motion.div
                        layout
                        key={\`\${panelItem.id || panelItem.name || index}-\${index}\`}
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        style={{ 
                          width: 'min(600px, 90vw)'
                        }}
                        className={\`h-full border-l shadow-2xl flex flex-col shrink-0 pointer-events-auto \${index === 0 ? 'ml-auto' : ''} \${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}\`}
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

const finalReplacement = newPanelContent + panelBodyContent + `
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        `;

content = content.substring(0, startIndex) + finalReplacement + content.substring(endIndex);
fs.writeFileSync('src/App.tsx', content);
console.log('Replacement successful');
