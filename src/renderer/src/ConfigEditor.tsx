import React, { useState, useEffect } from 'react';
import './ConfigEditor.css';

interface Config {
  port: string;
  baudRate: number;
  slider_mapping: Record<string, string | string[]>;
}

export default function ConfigEditor() {
  const [config, setConfig] = useState<Config>({
    port: 'COM4',
    baudRate: 9600,
    slider_mapping: {
      '0': 'master',
      '1': [],
      '2': [],
      '3': [],
    },
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processes, setProcesses] = useState<string[]>([]);
  const [openDropdown, setOpenDropdown] = useState<{
    sliderIndex: string;
    appIndex?: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Load config and processes on component mount
  useEffect(() => {
    window.electron.ipcRenderer.once('load-config', (_, ...args) => {
      const result = args[0] as Config;
      if (result) {
        setConfig(result);
      }
    });
    window.electron.ipcRenderer.send('load-config');

    // Load processes
    window.electron.ipcRenderer.once('get-processes', (_, ...args) => {
      const processList = args[0] as string[];
      setProcesses(processList);
    });
    window.electron.ipcRenderer.send('get-processes');

    // Close dropdown on click outside
    const handleClickOutside = () => {
      setOpenDropdown(null);
      setSearchQuery('');
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig({
      ...config,
      port: e.target.value,
    });
    setSaved(false);
  };

  const handleBaudRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!Number.isNaN(value)) {
      setConfig({
        ...config,
        baudRate: value,
      });
      setSaved(false);
    }
  };

  const handleSliderLabelChange = (sliderIndex: string, newLabel: string) => {
    const currentValue = config.slider_mapping[sliderIndex];
    const isArray = Array.isArray(currentValue);

    if (isArray) {
      // Keep the array, just don't change anything if it's an array
      return;
    }

    setConfig({
      ...config,
      slider_mapping: {
        ...config.slider_mapping,
        [sliderIndex]: newLabel,
      },
    });
    setSaved(false);
  };

  const handleAppAdd = (sliderIndex: string) => {
    const currentValue = config.slider_mapping[sliderIndex];
    let newValue: string | string[];

    if (Array.isArray(currentValue)) {
      newValue = [...currentValue, ''];
    } else {
      // Convert string to array
      newValue = [currentValue as string, ''];
    }

    setConfig({
      ...config,
      slider_mapping: {
        ...config.slider_mapping,
        [sliderIndex]: newValue,
      },
    });
    setSaved(false);
  };

  const handleAppChange = (
    sliderIndex: string,
    appIndex: number,
    newValue: string,
  ) => {
    const currentValue = config.slider_mapping[sliderIndex];
    if (Array.isArray(currentValue)) {
      const updatedArray = [...currentValue];
      updatedArray[appIndex] = newValue;
      setConfig({
        ...config,
        slider_mapping: {
          ...config.slider_mapping,
          [sliderIndex]: updatedArray,
        },
      });
      setSaved(false);
    }
  };

  const handleSelectProcess = (
    process: string,
    sliderIndex: string,
    appIndex?: number,
  ) => {
    if (appIndex !== undefined) {
      handleAppChange(sliderIndex, appIndex, process);
    } else {
      handleSliderLabelChange(sliderIndex, process);
    }
    setOpenDropdown(null);
    setSearchQuery('');
  };

  const filteredProcesses = processes.filter((proc) =>
    proc.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleAppRemove = (sliderIndex: string, appIndex: number) => {
    const currentValue = config.slider_mapping[sliderIndex];
    if (Array.isArray(currentValue)) {
      const updatedArray = currentValue.filter((_, i) => i !== appIndex);
      setConfig({
        ...config,
        slider_mapping: {
          ...config.slider_mapping,
          [sliderIndex]:
            updatedArray.length === 1 ? updatedArray[0] : updatedArray,
        },
      });
      setSaved(false);
    }
  };

  const handleSave = () => {
    setError(null);
    window.electron.ipcRenderer.once('save-config-response', (_, ...args) => {
      const response = args[0] as { success: boolean; error?: string };
      if (response.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(response.error || 'Failed to save config');
      }
    });
    window.electron.ipcRenderer.send('save-config', config);
  };

  return (
    <div className="config-editor">
      <h1>⚙️ EleDeej Configuration</h1>

      {error && (
        <div className="error-message">
          <span>❌</span> {error}
        </div>
      )}
      {saved && (
        <div className="success-message">
          <span>✓</span> Configuration saved successfully!
        </div>
      )}

      <div className="editor-section">
        <h2>Serial Connection Settings</h2>
        <div className="form-group">
          <label htmlFor="port">🔌 Serial Port:</label>
          <input
            id="port"
            type="text"
            value={config.port}
            onChange={handlePortChange}
            placeholder="e.g., COM4"
          />
        </div>

        <div className="form-group">
          <label htmlFor="baudRate">📊 Baud Rate:</label>
          <input
            id="baudRate"
            type="number"
            value={config.baudRate}
            onChange={handleBaudRateChange}
          />
        </div>
      </div>

      <div className="editor-section">
        <h2>Slider Mapping</h2>
        <p className="section-description">
          Configure which applications each slider controls. Mix single apps and
          multiple apps per slider.
        </p>

        {Object.keys(config.slider_mapping)
          .sort()
          .map((sliderIndex) => {
            const value = config.slider_mapping[sliderIndex];
            const isArray = Array.isArray(value);

            return (
              <div key={sliderIndex} className="slider-mapping">
                <div className="slider-header p-2.5">
                  <h3>🎚️ Slider {sliderIndex}</h3>
                </div>

                {isArray ? (
                  <div className="app-list">
                    {(value as string[]).map((app, appIndex) => (
                      <div key={app + appIndex} className="app-item">
                        <div className="process-selector">
                          <input
                            type="text"
                            value={app}
                            onChange={(e) =>
                              handleAppChange(
                                sliderIndex,
                                appIndex,
                                e.target.value,
                              )
                            }
                            onFocus={() =>
                              setOpenDropdown({
                                sliderIndex,
                                appIndex,
                              })
                            }
                            placeholder="Type or select a process..."
                          />
                          {openDropdown?.sliderIndex === sliderIndex &&
                            openDropdown?.appIndex === appIndex && (
                              <div className="dropdown-menu">
                                <input
                                  type="text"
                                  className="dropdown-search"
                                  placeholder="Search processes..."
                                  value={searchQuery}
                                  onChange={(e) =>
                                    setSearchQuery(e.target.value)
                                  }
                                  autoFocus
                                />
                                <div className="dropdown-list">
                                  {filteredProcesses.length > 0 ? (
                                    filteredProcesses.map((proc) => (
                                      <div
                                        key={proc}
                                        className="dropdown-item"
                                        onClick={() =>
                                          handleSelectProcess(
                                            proc,
                                            sliderIndex,
                                            appIndex,
                                          )
                                        }
                                      >
                                        {proc}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="dropdown-empty">
                                      No processes found
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAppRemove(sliderIndex, appIndex)}
                          className="btn-remove"
                          title="Remove application"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleAppAdd(sliderIndex)}
                      className="btn-add"
                    >
                      + Add Application
                    </button>
                  </div>
                ) : (
                  <div className="single-app">
                    <div className="process-selector">
                      <input
                        type="text"
                        value={value as string}
                        onChange={(e) =>
                          handleSliderLabelChange(sliderIndex, e.target.value)
                        }
                        onFocus={() =>
                          setOpenDropdown({
                            sliderIndex,
                          })
                        }
                        placeholder="Type or select a process..."
                      />
                      {openDropdown?.sliderIndex === sliderIndex &&
                        openDropdown?.appIndex === undefined && (
                          <div className="dropdown-menu">
                            <input
                              type="text"
                              className="dropdown-search"
                              placeholder="Search processes..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              autoFocus
                            />
                            <div className="dropdown-list">
                              {filteredProcesses.length > 0 ? (
                                filteredProcesses.map((proc) => (
                                  <div
                                    key={proc}
                                    className="dropdown-item"
                                    onClick={() =>
                                      handleSelectProcess(proc, sliderIndex)
                                    }
                                  >
                                    {proc}
                                  </div>
                                ))
                              ) : (
                                <div className="dropdown-empty">
                                  No processes found
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAppAdd(sliderIndex)}
                      className="btn-convert"
                      title="Convert to multiple applications"
                    >
                      → Multiple Apps
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      <div className="editor-footer">
        <button type="button" onClick={handleSave} className="btn-save">
          💾 Save Configuration
        </button>
      </div>
    </div>
  );
}
