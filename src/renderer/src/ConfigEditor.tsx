import React, { useState, useEffect } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card';
import { Label } from '@renderer/components/ui/label';
import { Alert, AlertDescription } from '@renderer/components/ui/alert';
import { Badge } from '@renderer/components/ui/badge';
import { Separator } from '@renderer/components/ui/separator';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@renderer/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@renderer/components/ui/command';
import {
  Check,
  AlertCircle,
  CheckCircle2,
  Settings2,
  Sliders,
  Plug,
} from 'lucide-react';
import { cn } from '@renderer/utils/cn';

interface Config {
  port: string;
  baudRate: number;
  slider_mapping: Record<string, string | string[]>;
}

interface ProcessSelectorProps {
  value: string;
  onChange: (value: string) => void;
  processes: string[];
  placeholder?: string;
}

function ProcessSelector({
  value,
  onChange,
  processes,
  placeholder = 'Select or type a process...',
}: ProcessSelectorProps) {
  return (
    <Popover
      onOpenChange={() => {
        window.electron.ipcRenderer.send('get-processes');
      }}
    >
      <PopoverTrigger asChild>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search processes..." />
          <CommandEmpty>No processes found.</CommandEmpty>
          <CommandList>
            <CommandGroup>
              {processes.map((proc) => (
                <CommandItem
                  key={proc}
                  value={proc}
                  onSelect={() => onChange(proc)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === proc ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {proc}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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

  // Load config and processes on component mount
  useEffect(() => {
    const cleanupLoadConfig = window.electron.ipcRenderer.once(
      'load-config',
      (_, ...args) => {
        const result = args[0] as Config;
        if (result) {
          setConfig(result);
        }
      },
    );
    window.electron.ipcRenderer.send('load-config');

    // Load processes
    const cleanupGetProcesses = window.electron.ipcRenderer.on(
      'get-processes',
      (_, ...args) => {
        const processList = args[0] as string[];
        setProcesses(processList);
      },
    );
    window.electron.ipcRenderer.send('get-processes');

    return () => {
      cleanupLoadConfig();
      cleanupGetProcesses();
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
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Settings2 className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900">
              EleDeej Configuration
            </h1>
          </div>
          <p className="text-slate-600">
            Manage your serial connection and slider mappings
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Configuration saved successfully!
            </AlertDescription>
          </Alert>
        )}

        {/* Serial Connection Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plug className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle>Serial Connection Settings</CardTitle>
                <CardDescription>
                  Configure your device connection parameters
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="port" className="text-base">
                  Serial Port
                </Label>
                <Input
                  id="port"
                  type="text"
                  value={config.port}
                  onChange={handlePortChange}
                  placeholder="e.g., COM4"
                  className="text-base"
                />
                <p className="text-sm text-slate-500">
                  e.g., COM4, /dev/ttyUSB0
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baudRate" className="text-base">
                  Baud Rate
                </Label>
                <Input
                  id="baudRate"
                  type="number"
                  value={config.baudRate}
                  onChange={handleBaudRateChange}
                  className="text-base"
                />
                <p className="text-sm text-slate-500">e.g., 9600, 115200</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Slider Mapping */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle>Slider Mapping</CardTitle>
                <CardDescription>
                  Configure which applications each slider controls
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {Object.keys(config.slider_mapping)
              .sort()
              .map((sliderIndex) => {
                const value = config.slider_mapping[sliderIndex];
                const isArray = Array.isArray(value);

                return (
                  <div key={sliderIndex} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-base px-3 py-1">
                        Slider {sliderIndex}
                      </Badge>
                    </div>

                    {isArray ? (
                      <div className="space-y-3">
                        <ScrollArea className="h-auto border rounded-lg p-4 space-y-3">
                          {(value as string[]).map((app, appIndex) => (
                            <div
                              key={app + appIndex}
                              className="flex gap-2 mb-3 last:mb-0"
                            >
                              <ProcessSelector
                                value={app}
                                onChange={(newValue) =>
                                  handleAppChange(
                                    sliderIndex,
                                    appIndex,
                                    newValue,
                                  )
                                }
                                processes={processes}
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() =>
                                  handleAppRemove(sliderIndex, appIndex)
                                }
                                title="Remove application"
                              >
                                ✕
                              </Button>
                            </div>
                          ))}
                        </ScrollArea>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => handleAppAdd(sliderIndex)}
                        >
                          + Add Application
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <ProcessSelector
                          value={value as string}
                          onChange={(newValue) =>
                            handleSliderLabelChange(sliderIndex, newValue)
                          }
                          processes={processes}
                        />
                        <Button
                          variant="outline"
                          onClick={() => handleAppAdd(sliderIndex)}
                          title="Convert to multiple applications"
                        >
                          → Multiple Apps
                        </Button>
                      </div>
                    )}
                    {sliderIndex !==
                      Object.keys(config.slider_mapping).sort()[
                        Object.keys(config.slider_mapping).length - 1
                      ] && <Separator />}
                  </div>
                );
              })}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            size="lg"
            className="bg-blue-600 hover:bg-blue-700"
          >
            💾 Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}
