
import React, { useState, useEffect, useRef } from 'react';
import { Camera, Upload, Layers, Ruler, ChevronRight, RefreshCw, Download, FileText, Trash2, Globe, AlertCircle, Info, HelpCircle } from 'lucide-react';
import { ImageUpload, VisualizerState, ReferenceType, Point, Box } from './types';
import { analyzeMarkedRegions, generateMaskedVisualization } from './services/geminiService';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

const App: React.FC = () => {
  const [roomImage, setRoomImage] = useState<ImageUpload | null>(null);
  const [wallpaperImage, setWallpaperImage] = useState<ImageUpload | null>(null);
  const [refType, setRefType] = useState<ReferenceType>(ReferenceType.A4_PAPER);
  const [refHeight, setRefHeight] = useState<number>(210);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentBox, setCurrentBox] = useState<Box | null>(null);
  const [completedBoxes, setCompletedBoxes] = useState<Box[]>([]);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [visualizedImage, setVisualizedImage] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<VisualizerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keySelected, setKeySelected] = useState(true);

  // useEffect(() => {
  //   checkApiKey();
  // }, []);

  const checkApiKey = async () => {
    try {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setKeySelected(hasKey);
      }
    } catch (e) {
      console.error("API Key check failed", e);
    }
  };

  const handleSelectKey = async () => {
    try {
      if (window.aistudio) {
        await window.aistudio.openSelectKey();
        setKeySelected(true);
      }
    } catch (e) {
      console.error("Key selection error", e);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (img: ImageUpload) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setter({ data: base64, mimeType: file.type });
      if (setter === setRoomImage) {
        setCompletedBoxes([]);
        setVisualizedImage(null);
        setMetadata(null);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const getNormalizedCoords = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): Point | null => {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return [Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))];
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Prevent default to avoid browser's native image dragging
    e.preventDefault();
    const coords = getNormalizedCoords(e);
    if (coords) {
      setIsDrawing(true);
      setStartPoint(coords);
      setCurrentBox({ start: coords, end: coords });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getNormalizedCoords(e);
    if (!coords) return;
    setMousePos(coords);
    if (isDrawing && startPoint) {
      setCurrentBox({ start: startPoint, end: coords });
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentBox) {
      const width = Math.abs(currentBox.end[0] - currentBox.start[0]);
      const height = Math.abs(currentBox.end[1] - currentBox.start[1]);
      // Small threshold to prevent single clicks from creating tiny boxes
      if (width > 0.5 && height > 0.5) {
        setCompletedBoxes([...completedBoxes, currentBox]);
      }
    }
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentBox(null);
  };

  const undoLastBox = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completedBoxes.length > 0) {
      setCompletedBoxes(completedBoxes.slice(0, -1));
    }
  };

  const startProcess = async () => {
    if (!roomImage || !wallpaperImage || completedBoxes.length === 0) {
      setError("Please draw at least one area box and upload a pattern before beginning.");
      return;
    }
    
    setError(null);
    setIsAnalyzing(true);
    try {
      const actualHeight = refType === ReferenceType.A4_PAPER ? 29.7 : refHeight;
      const analysisData = await analyzeMarkedRegions(roomImage, wallpaperImage, refType, actualHeight, completedBoxes);
      setMetadata(analysisData);
      setIsAnalyzing(false);
      setIsGenerating(true);
      const resultImage = await generateMaskedVisualization(roomImage, wallpaperImage, analysisData);
      setVisualizedImage(resultImage);
    } catch (err: any) {
      if (err.message?.includes("Requested entity was not found.")) {
        setKeySelected(false);
        handleSelectKey();
        return;
      }
      setError("Atelier synthesis failed. Please re-check markers and spatial calibration.");
    } finally {
      setIsAnalyzing(false);
      setIsGenerating(false);
    }
  };

  const reset = () => {
    setRoomImage(null);
    setWallpaperImage(null);
    setVisualizedImage(null);
    setMetadata(null);
    setError(null);
    setCompletedBoxes([]);
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentBox(null);
  };

  if (!keySelected) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-12 border border-slate-100 rounded-sm">
          <div className="font-luxury mb-12 uppercase tracking-[0.5em] text-[#8c734b] text-2xl">FROMENTAL</div>
          <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] mb-12 leading-relaxed">
            Please connect your Gemini API Key to proceed to the bespoke atelier visualizer.
          </p>
          <button onClick={handleSelectKey} className="w-full btn-fromental text-white">
            Connect AI Studio
          </button>
        </div>
      </div>
    );
  }

  const renderBox = (box: Box, index: number, isCurrent = false) => {
    const x = Math.min(box.start[0], box.end[0]);
    const y = Math.min(box.start[1], box.end[1]);
    const width = Math.abs(box.end[0] - box.start[0]);
    const height = Math.abs(box.end[1] - box.start[1]);
    
    return (
      <rect
        key={index}
        x={x}
        y={y}
        width={width}
        height={height}
        fill={isCurrent ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.4)"}
        stroke="#2563eb"
        strokeWidth="0.5"
        strokeDasharray={isCurrent ? "1,1" : "0"}
      />
    );
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Brand Header */}
      <header className="px-12 py-12 border-b border-slate-50 flex justify-between items-baseline bg-white">
        <div className="font-luxury text-2xl tracking-[0.3em] cursor-pointer" onClick={reset}>FROMENTAL</div>
        <div className="label-secondary">Bespoke Workspace</div>
      </header>

      <main className="flex-1 max-w-[1500px] mx-auto w-full px-12 py-16">
        {!visualizedImage && !isAnalyzing && !isGenerating ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 animate-fade-in">
            {/* Setup Left: Room Context & Marking */}
            <div className="space-y-10">
              <div className="space-y-4">
                <label className="label-spaced">1. Room Perspective (Draw Blue Boxes)</label>
                <div className="relative border border-slate-100 bg-[#fafafa] min-h-[500px] flex items-center justify-center overflow-hidden rounded-sm group shadow-sm">
                  {!roomImage ? (
                    <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-all">
                      <Camera className="w-8 h-8 text-slate-200 mb-4" />
                      <span className="label-secondary">Upload Project Photo</span>
                      <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, setRoomImage)} accept="image/*" />
                    </label>
                  ) : (
                    <div 
                      className="relative w-full cursor-crosshair select-none overflow-hidden" 
                      onMouseDown={handleMouseDown} 
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    >
                      <img 
                        ref={imgRef} 
                        src={`data:image/png;base64,${roomImage.data}`} 
                        className="w-full h-auto block" 
                        alt="Room View" 
                        draggable="false"
                      />
                      <svg 
                        viewBox="0 0 100 100" 
                        preserveAspectRatio="none" 
                        className="absolute inset-0 w-full h-full pointer-events-none"
                      >
                        {completedBoxes.map((box, i) => renderBox(box, i))}
                        {currentBox && renderBox(currentBox, -1, true)}
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {roomImage && (
                <div className="flex items-center justify-between p-6 bg-white border border-slate-100 rounded-sm">
                  <div className="space-y-1">
                    <span className="label-spaced text-[#1a1a1a]">Wall Area Selection</span>
                    <p className="label-secondary opacity-60 lowercase tracking-widest">{completedBoxes.length} boxes defined</p>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={undoLastBox} className="p-3 text-slate-300 hover:text-red-500 transition-colors flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      <span className="label-secondary text-[10px]">Undo Last</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Setup Right: Asset & Calibration */}
            <div className="space-y-10">
              <div className="space-y-4">
                <label className="label-spaced">2. Wallpaper Asset</label>
                <div className="relative border border-slate-100 bg-[#fafafa] min-h-[500px] flex items-center justify-center overflow-hidden rounded-sm group shadow-sm">
                  {!wallpaperImage ? (
                    <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-all">
                      <Upload className="w-8 h-8 text-slate-200 mb-4" />
                      <span className="label-secondary">Upload Panoramic Design</span>
                      <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, setWallpaperImage)} accept="image/*" />
                    </label>
                  ) : (
                    <div className="relative w-full h-full">
                      <img src={`data:image/png;base64,${wallpaperImage.data}`} className="w-full h-full object-cover" alt="Wallpaper Design" draggable="false" />
                      <button onClick={() => setWallpaperImage(null)} className="absolute top-4 right-4 p-3 bg-white/90 backdrop-blur rounded-full shadow-lg text-slate-400 hover:text-red-500 transition-all">
                        <RefreshCw className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-10 border border-slate-100 bg-white rounded-sm space-y-10">
                <section className="space-y-6">
                  <label className="label-spaced">Spatial Calibration</label>
                  <div className="relative">
                    <select 
                      className="w-full border-b border-slate-200 py-4 text-[0.7rem] uppercase tracking-widest font-bold appearance-none bg-transparent outline-none focus:border-[#8c734b]"
                      value={refType}
                      onChange={(e) => setRefType(e.target.value as ReferenceType)}
                    >
                      <option value={ReferenceType.A4_PAPER}>A4 Paper Standard (29.7cm)</option>
                      <option value={ReferenceType.DOOR_FRAME}>Door Leaf Reference (Custom CM)</option>
                    </select>
                    <ChevronRight className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rotate-90 text-slate-300 pointer-events-none" />
                  </div>
                  {refType === ReferenceType.DOOR_FRAME && (
                    <div className="animate-in fade-in slide-in-from-top-2">
                      <label className="label-secondary block mb-2">Object Height in CM</label>
                      <input type="number" value={refHeight} onChange={(e) => setRefHeight(Number(e.target.value))} className="w-full border-b border-slate-200 py-2 text-2xl font-light outline-none focus:border-[#8c734b]" />
                    </div>
                  )}
                </section>

                <div className="pt-4">
                  <button 
                    disabled={!roomImage || !wallpaperImage || completedBoxes.length === 0}
                    onClick={startProcess}
                    className="w-full btn-fromental flex items-center justify-center gap-3"
                  >
                    Synthesize Visualization
                  </button>
                  {error && <div className="mt-4 p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] uppercase tracking-widest font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-fade-in">
            {/* Synthesis Results View */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-20 items-start">
              {/* Left: Final Visualization */}
              <div className="lg:col-span-8">
                <div className="relative aspect-[16/10] bg-[#fbfbfb] border border-slate-100 overflow-hidden shadow-sm group">
                  {visualizedImage && <img src={visualizedImage} className="w-full h-full object-cover" alt="Visualization Synthesis" />}
                  {(isGenerating || isAnalyzing) && (
                    <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center">
                      <RefreshCw className="w-12 h-12 text-[#8c734b] animate-spin mb-8" />
                      <p className="font-luxury text-3xl tracking-widest text-[#1a1a1a] uppercase">
                        {isAnalyzing ? 'Analyzing Spatial Context...' : 'Performing Spatial Synthesis...'}
                      </p>
                      <p className="label-secondary mt-4 opacity-50 tracking-[0.2em]">Calculating panoramic sequence and lighting</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-8 mt-12">
                   <button onClick={reset} className="btn-outline px-12">New Simulation</button>
                   <button className="btn-outline px-12 flex items-center gap-2">
                     <Download className="w-4 h-4" /> Export High-Res Render
                   </button>
                </div>
              </div>

              {/* Right: Requirements Card */}
              <div className="lg:col-span-4">
                <div className="sidebar-card relative shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
                  {/* Decorative Icon */}
                  <div className="absolute top-10 right-10 opacity-[0.08]">
                    <Layers className="w-24 h-24 text-slate-300" />
                  </div>

                  <div className="label-spaced mb-16 text-[#8c734b] text-[0.75rem]">Estimated Requirements</div>
                  
                  <div className="text-[12rem] font-light leading-none text-[#1a1a1a] mb-4">
                    {metadata?.total_rolls_estimated || "—"}
                  </div>
                  
                  <div className="label-spaced text-[#94a3b8] mb-16 text-[0.7rem] tracking-[0.3em]">
                    Unique 70cm Panoramic Panels
                  </div>
                  
                  <div className="w-full h-[1px] bg-slate-100 mb-16 max-w-[200px]"></div>
                  
                  <p className="text-[0.65rem] text-slate-400 uppercase tracking-[0.25em] leading-[2] italic text-center max-w-[280px]">
                    Based on the measured horizontal span and vertical height, this unique print sequence ensures a seamless panoramic fit across all identified segments.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Global Status Footer */}
      <footer className="px-12 py-10 border-t border-slate-50 flex justify-between items-center bg-white">
        <div className="flex items-center text-[0.7rem] uppercase tracking-[0.3em] font-bold text-slate-400">
          <span className={`status-dot ${isAnalyzing || isGenerating ? 'animate-pulse bg-[#8c734b]' : 'bg-[#1a1a1a]'}`}></span>
          System State: {isAnalyzing ? 'Analyzing Spatial Context' : isGenerating ? 'Synthesizing Render' : 'Visualizer Active'}
        </div>
        <div className="text-[0.7rem] uppercase tracking-[0.3em] font-bold text-slate-400">
          © FROMENTAL 2025
        </div>
      </footer>
    </div>
  );
};

export default App;
