import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Trash2, ScanLine, User, CreditCard, MapPin, Calendar, 
  Briefcase, Heart, Globe, Shield, Download, Search, Plus, Copy, 
  Check, Eye, AlertTriangle, X, FileSpreadsheet, FileJson, RefreshCw, 
  Database, Sparkles, CheckCircle2, ChevronRight, Wifi, WifiOff, FileText, Lock
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

// Form standar KTP kosong
const INITIAL_FORM = {
  nik: '',
  nama: '',
  tempatTglLahir: '',
  jenisKelamin: '',
  alamat: '',
  rtRw: '',
  kelDesa: '',
  kecamatan: '',
  agama: '',
  statusPerkawinan: '',
  pekerjaan: '',
  kewarganegaraan: 'WNI'
};

const LOCAL_STORAGE_KEY = 'ktp_scanner_records_v4';

// Inisialisasi Firebase Config
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyD3G1HWzxoyBJhR-zWxGENNwR8w43kX0N8",
  authDomain: "tckokuo-2d6d3.firebaseapp.com",
  projectId: "tckokuo-2d6d3",
  storageBucket: "tckokuo-2d6d3.firebasestorage.app",
  messagingSenderId: "468659295902",
  appId: "1:468659295902:web:2a63ebaa7ab56f8a3c8d8f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'ktp-scanner-app';

export default function App() {
  // Authentication & Firebase State
  const [user, setUser] = useState(null);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Navigation Tab State: 'scan' | 'database'
  const [activeTab, setActiveTab] = useState('scan');
  
  // Temporary RAM Image Preview (Auto cleared on Save/Reset)
  const [tempPreviewUrl, setTempPreviewUrl] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const [isTesseractReady, setIsTesseractReady] = useState(false);
  const [rawText, setRawText] = useState('');
  const [showRawText, setShowRawText] = useState(false);
  
  // Form Data State (Strictly Text Attributes)
  const [ktpForm, setKtpForm] = useState(INITIAL_FORM);

  // Cloud & Local Records Database State
  const [savedRecords, setSavedRecords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // UI Modals & Toast States
  const [selectedKtpDetail, setSelectedKtpDetail] = useState(null);
  const [deleteModalConfig, setDeleteModalConfig] = useState({ show: false, id: null, title: '' });
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [copiedId, setCopiedId] = useState(null);

  const fileInputRef = useRef(null);

  // 1. Inisialisasi Firebase Auth & Tesseract Library Engine
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Firebase Auth Error:", err);
      }
    };
    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });

    // Dinamis Load Tesseract JS Engine
    const loadTesseract = async () => {
      if (window.Tesseract) {
        setIsTesseractReady(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async = true;
      script.onload = () => setIsTesseractReady(true);
      document.body.appendChild(script);
    };
    
    loadTesseract();

    return () => unsubscribeAuth();
  }, []);

  // 2. Sinkronisasi Real-time Firestore Collection Data
  useEffect(() => {
    if (!user) return;

    // Standard public collection path sesuai Aturan Firestore
    const collectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'ktp_records');
    
    const unsubscribeSnapshot = onSnapshot(
      collectionRef,
      (snapshot) => {
        const records = [];
        snapshot.forEach((docSnap) => {
          records.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        // Sorting di JavaScript memory berdasarkan timestamp terbaru
        records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        setSavedRecords(records);
        setIsFirebaseConnected(true);

        // Backup lokal otomatis
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
        } catch (e) {}
      },
      (error) => {
        console.warn("Firestore listener error, menggunakan cadangan LocalStorage:", error);
        setIsFirebaseConnected(false);
        try {
          const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (stored) setSavedRecords(JSON.parse(stored));
        } catch (err) {}
      }
    );

    return () => unsubscribeSnapshot();
  }, [user]);

  // Toast Notification Helper
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3500);
  };

  // Helper Simpan ke LocalStorage Cache
  const saveToLocalStorage = (data) => {
    try {
      setSavedRecords(data);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch (err) {}
  };

  // 3. OPTIMASI SPEED SCAN: ROI Text Cropping (75% Area Kiri-Atas) + Binarization
  const binarizeAndOptimizeImage = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const tempUrl = URL.createObjectURL(file);
      img.src = tempUrl;
      
      img.onload = () => {
        URL.revokeObjectURL(tempUrl); // Bersihkan URL sementara dari RAM
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Target resolusi optimal untuk Tesseract (Lebar Maks 750px)
        const MAX_WIDTH = 750;
        const scale = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
        const fullW = Math.floor(img.width * scale);
        const fullH = Math.floor(img.height * scale);

        // ROI CROP: Potong 75% area kiri-atas KTP (NIK, Nama, Alamat, TTL)
        // Membuang area foto wajah (sebelah kanan) dan tanda tangan/stempel (bawah)
        const cropW = Math.floor(fullW * 0.75);
        const cropH = Math.floor(fullH * 0.75);

        canvas.width = cropW;
        canvas.height = cropH;

        // Draw area ROI khusus teks dari gambar asli ke canvas
        ctx.drawImage(
          img, 
          0, 0, img.width * 0.75, img.height * 0.75, // Source ROI
          0, 0, cropW, cropH                         // Destination Canvas
        );
        
        // Ambil piksel mentah ROI untuk pemrosesan Binarization (Filter Kontras Hitam-Putih)
        const imageData = ctx.getImageData(0, 0, cropW, cropH);
        const data = imageData.data;

        // Hitung rata-rata tingkat kecerahan (luminance) area teks
        let totalLuminance = 0;
        const pixelCount = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          totalLuminance += gray;
        }
        const avgLuminance = totalLuminance / pixelCount;
        // Threshold dinamis (antara 90 - 150)
        const threshold = Math.min(Math.max(avgLuminance * 0.95, 90), 150);

        // Binarization: Ubah piksel menjadi Hitam Pekat (Teks) atau Putih Bersih (Background)
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const val = gray > threshold ? 255 : 0;
          data[i] = val;     // R
          data[i + 1] = val; // G
          data[i + 2] = val; // B
        }

        ctx.putImageData(imageData, 0, 0);
        
        // Hasilkan image data URL khusus untuk proses OCR
        resolve(canvas.toDataURL('image/png'));
      };

      img.onerror = (err) => reject(err);
    });
  };

  // 4. Handle Tangkap Foto KTP
  const handleImageCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsScanning(true);
      setScanProgress(5);
      setScanStatus('Memotong ROI teks & mengaplikasikan filter Binarization...');

      // Tampilkan preview sementara di RAM (bukan disimpan)
      const previewUrl = URL.createObjectURL(file);
      setTempPreviewUrl(previewUrl);

      // Optimasi gambar dengan ROI Crop & Binarization
      const optimizedOcrImage = await binarizeAndOptimizeImage(file);
      
      // Jalankan OCR Engine
      performOCR(optimizedOcrImage);
    } catch (error) {
      console.error("Gagal mengolah gambar:", error);
      setIsScanning(false);
      showToast("Gagal mengolah file gambar KTP", "error");
    }
  };

  // 5. Eksekusi OCR Tesseract dengan Whitelist & Persentase Log
  const performOCR = async (binaryImageData) => {
    if (!window.Tesseract) {
      showToast("Pemindai OCR belum siap, silakan tunggu...", "error");
      setIsScanning(false);
      return;
    }

    try {
      setScanStatus('Menyiapkan Mesin AI Tesseract...');

      const worker = await window.Tesseract.createWorker({
        logger: m => {
          if (m.status === 'recognizing text') {
            const p = Math.round(m.progress * 100);
            setScanProgress(p);
            setScanStatus(`Membaca teks KTP... ${p}%`);
          } else if (m.status === 'loading tesseract core') {
            setScanStatus('Memuat core engine AI...');
          } else if (m.status === 'loading language traineddata') {
            setScanStatus('Memuat kamus karakter...');
          }
        }
      });
      
      // Inisialisasi bahasa Indonesia
      await worker.loadLanguage('ind');
      await worker.initialize('ind');
      
      // Whitelist Karakter KTP untuk kecepatan pemrosesan maksimal
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -:/,.',
      });
      
      setScanStatus('Mengekstrak bidang data...');
      const { data: { text } } = await worker.recognize(binaryImageData);
      
      setRawText(text);
      extractKtpFields(text);
      await worker.terminate();
      
      showToast("Pemindaian data KTP berhasil!");
    } catch (error) {
      console.error("OCR Execution Error:", error);
      setScanStatus('Gagal membaca gambar KTP.');
      showToast("Gagal membaca teks KTP", "error");
    } finally {
      setIsScanning(false);
    }
  };

  // 6. Parsing & Ekstraksi Bidang Teks KTP
  const extractKtpFields = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const textUpper = text.toUpperCase();

    let extracted = { ...INITIAL_FORM };

    // NIK (16 Digit Angka)
    const nikMatch = textUpper.match(/\b\d{16}\b/);
    if (nikMatch) {
      extracted.nik = nikMatch[0];
    }

    // Jenis Kelamin
    if (textUpper.includes('LAKI')) {
      extracted.jenisKelamin = 'LAKI-LAKI';
    } else if (textUpper.includes('PEREMPUAN')) {
      extracted.jenisKelamin = 'PEREMPUAN';
    }

    // Agama
    const agamaList = ['ISLAM', 'KRISTEN', 'KATHOLIK', 'HINDU', 'BUDHA', 'KHONGHUCU'];
    for (const ag of agamaList) {
      if (textUpper.includes(ag)) {
        extracted.agama = ag;
        break;
      }
    }

    // Status Perkawinan
    if (textUpper.includes('BELUM KAWIN')) {
      extracted.statusPerkawinan = 'BELUM KAWIN';
    } else if (textUpper.includes('KAWIN')) {
      extracted.statusPerkawinan = 'KAWIN';
    } else if (textUpper.includes('CERAI')) {
      extracted.statusPerkawinan = 'CERAI';
    }

    // Kewarganegaraan
    if (textUpper.includes('WNA')) extracted.kewarganegaraan = 'WNA';
    else extracted.kewarganegaraan = 'WNI';

    // Parsing per line
    lines.forEach((line, idx) => {
      const uLine = line.toUpperCase();

      // Nama
      if (uLine.includes('NAMA')) {
        const clean = uLine.replace(/.*NAMA\s*[:;-]?\s*/, '').trim();
        if (clean.length > 2) {
          extracted.nama = clean.replace(/[^A-Z\s.,]/g, '');
        } else if (lines[idx + 1]) {
          extracted.nama = lines[idx + 1].toUpperCase().replace(/[^A-Z\s.,]/g, '').trim();
        }
      }

      // Tempat/Tgl Lahir
      if (uLine.includes('TEMPAT') || uLine.includes('LAHIR')) {
        const clean = uLine.replace(/.*(LAHIR|TEMPAT\/TGL LAHIR)\s*[:;-]?\s*/, '').trim();
        if (clean.length > 3) {
          extracted.tempatTglLahir = clean.replace(/[^A-Z0-9\s.,/-]/g, '');
        }
      }

      // Alamat
      if (uLine.includes('ALAMAT')) {
        const clean = uLine.replace(/.*ALAMAT\s*[:;-]?\s*/, '').trim();
        if (clean.length > 2) extracted.alamat = clean;
      }

      // RT/RW
      if (uLine.includes('RT') || uLine.includes('RW')) {
        const clean = uLine.replace(/.*RT\s*\/\s*RW\s*[:;-]?\s*/, '').trim();
        if (clean) extracted.rtRw = clean;
      }

      // Kel/Desa
      if (uLine.includes('KEL') || uLine.includes('DESA')) {
        const clean = uLine.replace(/.*(KELURAHAN|KEL|DESA)\s*[:;-]?\s*/, '').trim();
        if (clean) extracted.kelDesa = clean;
      }

      // Kecamatan
      if (uLine.includes('KECAMATAN') || uLine.includes('KEC')) {
        const clean = uLine.replace(/.*(KECAMATAN|KEC)\s*[:;-]?\s*/, '').trim();
        if (clean) extracted.kecamatan = clean;
      }

      // Pekerjaan
      if (uLine.includes('PEKERJAAN')) {
        const clean = uLine.replace(/.*PEKERJAAN\s*[:;-]?\s*/, '').trim();
        if (clean.length > 2) extracted.pekerjaan = clean;
      }
    });

    setKtpForm(extracted);
  };

  // Handle Form Change
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setKtpForm(prev => ({ ...prev, [name]: value }));
  };

  // Clear & Reset Form + Purge Temp RAM Image
  const resetForm = () => {
    if (tempPreviewUrl) {
      URL.revokeObjectURL(tempPreviewUrl);
    }
    setTempPreviewUrl(null);
    setKtpForm(INITIAL_FORM);
    setRawText('');
    setShowRawText(false);
    setScanProgress(0);
    setScanStatus('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 7. Simpan Data 100% TEKS ke Firestore (Auto-clear Form setelah simpan)
  const handleSaveData = async (e) => {
    e.preventDefault();
    if (!ktpForm.nik && !ktpForm.nama) {
      showToast("Harap isi NIK atau Nama sebelum menyimpan", "error");
      return;
    }

    // PAYLOAD MURNI TEKS (TIDAK MEMUAT GAMBAR / BASE64)
    const payload = {
      nik: ktpForm.nik.trim(),
      nama: ktpForm.nama.trim(),
      tempatTglLahir: ktpForm.tempatTglLahir.trim(),
      jenisKelamin: ktpForm.jenisKelamin,
      alamat: ktpForm.alamat.trim(),
      rtRw: ktpForm.rtRw.trim(),
      kelDesa: ktpForm.kelDesa.trim(),
      kecamatan: ktpForm.kecamatan.trim(),
      agama: ktpForm.agama.trim(),
      statusPerkawinan: ktpForm.statusPerkawinan.trim(),
      pekerjaan: ktpForm.pekerjaan.trim(),
      kewarganegaraan: ktpForm.kewarganegaraan.trim(),
      timestamp: Date.now(),
      createdAt: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
      createdBy: user?.uid || 'anonymous'
    };

    try {
      if (user && isFirebaseConnected) {
        // Path koleksi publik Firestore standar
        const collectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'ktp_records');
        await addDoc(collectionRef, payload);
        showToast("Data teks KTP berhasil disimpan ke Firebase Cloud!");
      } else {
        // Fallback Local Storage
        const newRecord = { ...payload, id: Date.now().toString() };
        const updated = [newRecord, ...savedRecords];
        saveToLocalStorage(updated);
        showToast("Data disalin ke penyimpanan lokal (Offline)");
      }

      // Bersihkan Form & Hapus Gambar Temporary dari RAM
      resetForm();
    } catch (err) {
      console.error("Gagal menyimpan ke Firestore:", err);
      const newRecord = { ...payload, id: Date.now().toString() };
      const updated = [newRecord, ...savedRecords];
      saveToLocalStorage(updated);
      showToast("Disimpan ke lokal (Error koneksi cloud)", "error");
      resetForm();
    }
  };

  // 8. Hapus Record Data KTP
  const confirmDelete = async () => {
    if (deleteModalConfig.id === 'ALL') {
      if (user && isFirebaseConnected) {
        try {
          const deletePromises = savedRecords.map(item => {
            if (item.id) {
              const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'ktp_records', item.id);
              return deleteDoc(docRef);
            }
            return Promise.resolve();
          });
          await Promise.all(deletePromises);
          showToast("Seluruh database KTP di Cloud telah dibersihkan");
        } catch (err) {
          console.error("Gagal hapus batch:", err);
        }
      }
      saveToLocalStorage([]);
    } else if (deleteModalConfig.id) {
      if (user && isFirebaseConnected) {
        try {
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'ktp_records', deleteModalConfig.id);
          await deleteDoc(docRef);
          showToast("Data KTP berhasil dihapus dari Cloud");
        } catch (err) {
          console.error("Gagal hapus doc Cloud:", err);
          const updated = savedRecords.filter(item => item.id !== deleteModalConfig.id);
          saveToLocalStorage(updated);
          showToast("Data KTP berhasil dihapus");
        }
      } else {
        const updated = savedRecords.filter(item => item.id !== deleteModalConfig.id);
        saveToLocalStorage(updated);
        showToast("Data KTP berhasil dihapus");
      }
    }
    setDeleteModalConfig({ show: false, id: null, title: '' });
  };

  // 9. Ekspor File (CSV / JSON)
  const exportAsJSON = () => {
    // Pastikan tidak ada data gambar di ekspor
    const cleanRecords = savedRecords.map(({ image, ...rest }) => rest);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cleanRecords, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `database_ktp_text_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("File JSON (Data Teks) diunduh");
  };

  const exportAsCSV = () => {
    if (savedRecords.length === 0) return;
    const headers = ["NIK", "Nama", "TTL", "Jenis Kelamin", "Alamat", "RT/RW", "Kel/Desa", "Kecamatan", "Agama", "Status", "Pekerjaan", "Kewarganegaraan", "Waktu Simpan"];
    
    const csvRows = [
      headers.join(','),
      ...savedRecords.map(r => [
        `"${r.nik || ''}"`,
        `"${r.nama || ''}"`,
        `"${r.tempatTglLahir || ''}"`,
        `"${r.jenisKelamin || ''}"`,
        `"${r.alamat || ''}"`,
        `"${r.rtRw || ''}"`,
        `"${r.kelDesa || ''}"`,
        `"${r.kecamatan || ''}"`,
        `"${r.agama || ''}"`,
        `"${r.statusPerkawinan || ''}"`,
        `"${r.pekerjaan || ''}"`,
        `"${r.kewarganegaraan || ''}"`,
        `"${r.createdAt || ''}"`
      ].join(','))
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `database_ktp_text_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("File CSV (Excel) diunduh");
  };

  const copyToClipboard = (text, id = null) => {
    navigator.clipboard.writeText(text);
    if (id) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
    showToast("Teks berhasil disalin!");
  };

  // Filtered Database Records
  const filteredRecords = savedRecords.filter(item => 
    item.nama?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.nik?.includes(searchQuery)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 pb-20">
      
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-cyan-600/15 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-xl mx-auto px-4 pt-6 space-y-6">
        
        {/* Header App */}
        <header className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-xs font-semibold backdrop-blur-md">
            <Lock className="w-3.5 h-3.5 text-cyan-400" /> ROI Text Crop (75%) • Binarized OCR
          </div>
          
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-100 to-cyan-300 bg-clip-text text-transparent">
            Scan KTP & Cloud Manager
          </h1>
          
          <div className="flex items-center justify-center gap-2 text-xs">
            {isFirebaseConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
                <Wifi className="w-3 h-3" /> Firebase Terhubung
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                <WifiOff className="w-3 h-3" /> Mode Local Storage
              </span>
            )}
          </div>
        </header>

        {/* Tab Selector */}
        <div className="grid grid-cols-2 p-1 bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all duration-300 ${
              activeTab === 'scan' 
                ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-lg shadow-indigo-500/25' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ScanLine className="w-4 h-4" />
            <span>Pindai KTP</span>
          </button>
          
          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all duration-300 relative ${
              activeTab === 'database' 
                ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-lg shadow-indigo-500/25' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Database Teks</span>
            {savedRecords.length > 0 && (
              <span className="ml-1 px-2 py-0.5 text-[10px] bg-indigo-400/30 border border-indigo-300/30 text-indigo-200 rounded-full font-bold">
                {savedRecords.length}
              </span>
            )}
          </button>
        </div>

        {/* ================= TAB 1: SCANNER & FORM ================= */}
        {activeTab === 'scan' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {/* Upload Area */}
            {!tempPreviewUrl ? (
              <div 
                onClick={() => isTesseractReady && fileInputRef.current?.click()}
                className={`group relative border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all duration-300 ${
                  isTesseractReady 
                    ? 'border-indigo-500/30 hover:border-indigo-500/60 bg-slate-900/40 hover:bg-slate-900/60 backdrop-blur-xl' 
                    : 'border-slate-800 bg-slate-900/20 cursor-not-allowed opacity-60'
                }`}
              >
                <div className="w-16 h-16 mx-auto mb-4 bg-indigo-500/10 rounded-2xl flex items-center justify-center border border-indigo-500/20 text-indigo-400 group-hover:scale-110 transition-transform">
                  <Camera className="w-8 h-8 text-cyan-400" />
                </div>
                <h3 className="font-semibold text-lg text-slate-200 mb-1">Ambil Foto KTP</h3>
                <p className="text-slate-400 text-xs max-w-xs mx-auto mb-4">
                  Sistem memotong <strong className="text-cyan-300">75% area teks KTP (ROI)</strong> & membuang foto wajah secara otomatis agar pemindaian instan.
                </p>
                <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all">
                  <Plus className="w-4 h-4" /> Unggah / Ambil Foto
                </span>
              </div>
            ) : (
              /* Temporary Preview Box */
              <div className="relative bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-3 shadow-2xl overflow-hidden">
                <img 
                  src={tempPreviewUrl} 
                  alt="KTP Temporary RAM Preview" 
                  className="w-full h-auto rounded-2xl object-contain bg-black/40 max-h-56"
                />

                {/* Privacy Badge */}
                <div className="absolute top-5 left-5 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 flex items-center gap-1.5 text-[10px] text-cyan-300">
                  <Lock className="w-3 h-3 text-cyan-400" /> Gambar RAM Sementara (Tidak Disimpan)
                </div>

                {/* Progress Overlay */}
                {isScanning && (
                  <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-14 h-14 relative mb-3">
                      <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                      <ScanLine className="absolute inset-0 m-auto w-6 h-6 text-cyan-400 animate-pulse" />
                    </div>
                    <p className="text-sm font-medium text-indigo-200 mb-2">{scanStatus}</p>
                    <div className="w-full max-w-xs h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-300"
                        style={{ width: `${scanProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {!isScanning && (
                  <button 
                    onClick={resetForm}
                    className="absolute top-5 right-5 p-2 bg-rose-500/80 hover:bg-rose-600 text-white rounded-xl backdrop-blur-md transition-all shadow-lg"
                    title="Ulangi Foto"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            <input 
              type="file" 
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handleImageCapture}
              className="hidden"
            />

            {/* Form Hasil Pemindaian & Verifikasi */}
            <form onSubmit={handleSaveData} className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                  <h2 className="font-semibold text-slate-200 text-base">Hasil Ekstraksi Data Teks</h2>
                </div>

                {rawText && (
                  <button 
                    type="button"
                    onClick={() => setShowRawText(!showRawText)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-cyan-500/20"
                  >
                    <FileText className="w-3 h-3" /> {showRawText ? 'Tutup Raw' : 'Lihat Raw OCR'}
                  </button>
                )}
              </div>

              {/* Raw Text Output */}
              {showRawText && rawText && (
                <div className="p-3 bg-slate-950/80 border border-cyan-500/30 rounded-2xl text-xs font-mono text-cyan-200/90 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  <div className="flex items-center justify-between mb-1 pb-1 border-b border-cyan-500/20">
                    <span className="text-[10px] uppercase font-bold text-cyan-400">Teks Mentah Hasil Binarization OCR</span>
                    <button 
                      type="button" 
                      onClick={() => copyToClipboard(rawText)}
                      className="text-[10px] text-cyan-300 hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Salin Teks
                    </button>
                  </div>
                  {rawText}
                </div>
              )}

              {/* Input Fields Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                
                {/* NIK (Numeric Keypad for Mobile) */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <CreditCard className="w-3.5 h-3.5 text-cyan-400" /> NIK (16 Digit Angka)
                  </label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    name="nik" 
                    value={ktpForm.nik} 
                    onChange={handleInputChange} 
                    placeholder="Contoh: 3171010101900001"
                    maxLength={16}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Nama */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <User className="w-3.5 h-3.5 text-cyan-400" /> Nama Lengkap
                  </label>
                  <input 
                    type="text" 
                    name="nama" 
                    value={ktpForm.nama} 
                    onChange={handleInputChange} 
                    placeholder="NAMA LENGKAP"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* TTL */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <Calendar className="w-3.5 h-3.5 text-cyan-400" /> Tempat/Tgl Lahir
                  </label>
                  <input 
                    type="text" 
                    name="tempatTglLahir" 
                    value={ktpForm.tempatTglLahir} 
                    onChange={handleInputChange} 
                    placeholder="JAKARTA, 01-01-1990"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Jenis Kelamin */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <User className="w-3.5 h-3.5 text-cyan-400" /> Jenis Kelamin
                  </label>
                  <select 
                    name="jenisKelamin" 
                    value={ktpForm.jenisKelamin} 
                    onChange={handleInputChange} 
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  >
                    <option value="">-- Pilih --</option>
                    <option value="LAKI-LAKI">LAKI-LAKI</option>
                    <option value="PEREMPUAN">PEREMPUAN</option>
                  </select>
                </div>

                {/* Alamat */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <MapPin className="w-3.5 h-3.5 text-cyan-400" /> Alamat
                  </label>
                  <input 
                    type="text" 
                    name="alamat" 
                    value={ktpForm.alamat} 
                    onChange={handleInputChange} 
                    placeholder="JL. NAMA JALAN / DUSUN"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* RT/RW (Numeric Keypad) */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 ml-1">RT / RW</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    name="rtRw" 
                    value={ktpForm.rtRw} 
                    onChange={handleInputChange} 
                    placeholder="001/002"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Kel/Desa */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 ml-1">Kelurahan / Desa</label>
                  <input 
                    type="text" 
                    name="kelDesa" 
                    value={ktpForm.kelDesa} 
                    onChange={handleInputChange} 
                    placeholder="NAMA KELURAHAN"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Kecamatan */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 ml-1">Kecamatan</label>
                  <input 
                    type="text" 
                    name="kecamatan" 
                    value={ktpForm.kecamatan} 
                    onChange={handleInputChange} 
                    placeholder="NAMA KECAMATAN"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Agama */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" /> Agama
                  </label>
                  <input 
                    type="text" 
                    name="agama" 
                    value={ktpForm.agama} 
                    onChange={handleInputChange} 
                    placeholder="ISLAM / KRISTEN / DSK"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Status Perkawinan */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <Heart className="w-3.5 h-3.5 text-cyan-400" /> Status Perkawinan
                  </label>
                  <input 
                    type="text" 
                    name="statusPerkawinan" 
                    value={ktpForm.statusPerkawinan} 
                    onChange={handleInputChange} 
                    placeholder="BELUM KAWIN / KAWIN"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Pekerjaan */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <Briefcase className="w-3.5 h-3.5 text-cyan-400" /> Pekerjaan
                  </label>
                  <input 
                    type="text" 
                    name="pekerjaan" 
                    value={ktpForm.pekerjaan} 
                    onChange={handleInputChange} 
                    placeholder="PEKERJAAN"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

                {/* Kewarganegaraan */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 ml-1">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" /> Kewarganegaraan
                  </label>
                  <input 
                    type="text" 
                    name="kewarganegaraan" 
                    value={ktpForm.kewarganegaraan} 
                    onChange={handleInputChange} 
                    placeholder="WNI"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>

              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center gap-3">
                <button 
                  type="submit"
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-indigo-600 via-cyan-600 to-emerald-500 hover:from-indigo-500 hover:to-emerald-400 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4" /> Simpan Data Teks ke Firebase
                </button>
                
                <button 
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl border border-white/10 transition-all"
                  title="Bersihkan Form"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </form>

          </div>
        )}

        {/* ================= TAB 2: DATABASE TEKS CLOUD ================= */}
        {activeTab === 'database' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            
            {/* Search & Action Bar */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari NIK atau Nama..."
                  className="w-full bg-slate-900/60 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 backdrop-blur-xl"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-3 text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <button 
                  onClick={() => setExportModalOpen(true)}
                  disabled={savedRecords.length === 0}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-slate-900/60 hover:bg-slate-800 border border-white/10 rounded-2xl text-xs font-semibold text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed backdrop-blur-xl transition-all"
                >
                  <Download className="w-4 h-4" /> Export
                </button>

                <button 
                  onClick={() => setDeleteModalConfig({ show: true, id: 'ALL', title: 'seluruh database Cloud' })}
                  disabled={savedRecords.length === 0}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-2xl text-xs font-semibold text-rose-400 disabled:opacity-40 disabled:cursor-not-allowed backdrop-blur-xl transition-all"
                >
                  <Trash2 className="w-4 h-4" /> Hapus Semua
                </button>
              </div>
            </div>

            {/* List Item Data */}
            {filteredRecords.length === 0 ? (
              <div className="bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-3xl p-10 text-center space-y-3">
                <Database className="w-12 h-12 mx-auto text-slate-600" />
                <h3 className="font-semibold text-slate-300">Belum ada data di database</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  {searchQuery ? "Data tidak ditemukan." : "Pindai KTP baru dan simpan data teks hasil OCR."}
                </p>
                {!searchQuery && (
                  <button 
                    onClick={() => setActiveTab('scan')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-cyan-600 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 mt-2"
                  >
                    <Plus className="w-4 h-4" /> Mulai Pindai KTP
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRecords.map((item) => (
                  <div 
                    key={item.id}
                    className="group bg-slate-900/60 hover:bg-slate-900/90 backdrop-blur-xl border border-white/10 hover:border-cyan-500/40 rounded-2xl p-4 transition-all duration-300 space-y-3 shadow-xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-cyan-400">{item.nik || 'N/A'}</span>
                          <span className="px-2 py-0.5 text-[10px] bg-slate-800 border border-white/5 rounded-md text-slate-400">
                            {item.jenisKelamin || 'N/A'}
                          </span>
                        </div>
                        <h3 className="font-semibold text-slate-100 text-base mt-0.5 uppercase tracking-wide">
                          {item.nama || 'TANPA NAMA'}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => setSelectedKtpDetail(item)}
                          className="p-2 text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-xl transition-all"
                          title="Detail Data"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        <button 
                          onClick={() => setDeleteModalConfig({ show: true, id: item.id, title: item.nama || item.nik })}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
                          title="Hapus Data"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-white/5 text-slate-400">
                      <div>
                        <span className="block text-[10px] text-slate-500">Alamat:</span>
                        <p className="truncate uppercase">{item.alamat || '-'}</p>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">Kecamatan:</span>
                        <p className="truncate uppercase">{item.kecamatan || '-'}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                      <span>Waktu: {item.createdAt}</span>
                      <button 
                        onClick={() => copyToClipboard(`NIK: ${item.nik}\nNama: ${item.nama}\nTTL: ${item.tempatTglLahir}\nAlamat: ${item.alamat}`, item.id)}
                        className="flex items-center gap-1 text-cyan-400 hover:underline"
                      >
                        {copiedId === item.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedId === item.id ? 'Tersalin' : 'Salin Text'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

      </div>

      {/* ================= MODAL DETAIL KTP ================= */}
      {selectedKtpDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setSelectedKtpDetail(null)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-3 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 text-cyan-400">
                <CreditCard className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">Detail Teks KTP</h3>
                <p className="text-xs text-slate-400">ID Doc: {selectedKtpDetail.id}</p>
              </div>
            </div>

            <div className="space-y-2 bg-slate-950/60 p-4 rounded-2xl border border-white/5 font-mono text-xs text-slate-300 max-h-72 overflow-y-auto space-y-1.5">
              <p><span className="text-slate-500">NIK           :</span> <strong className="text-cyan-300">{selectedKtpDetail.nik}</strong></p>
              <p><span className="text-slate-500">NAMA          :</span> {selectedKtpDetail.nama}</p>
              <p><span className="text-slate-500">TTL           :</span> {selectedKtpDetail.tempatTglLahir}</p>
              <p><span className="text-slate-500">JK            :</span> {selectedKtpDetail.jenisKelamin}</p>
              <p><span className="text-slate-500">ALAMAT        :</span> {selectedKtpDetail.alamat}</p>
              <p><span className="text-slate-500">RT/RW         :</span> {selectedKtpDetail.rtRw}</p>
              <p><span className="text-slate-500">KEL/DESA      :</span> {selectedKtpDetail.kelDesa}</p>
              <p><span className="text-slate-500">KECAMATAN     :</span> {selectedKtpDetail.kecamatan}</p>
              <p><span className="text-slate-500">AGAMA         :</span> {selectedKtpDetail.agama}</p>
              <p><span className="text-slate-500">STATUS        :</span> {selectedKtpDetail.statusPerkawinan}</p>
              <p><span className="text-slate-500">PEKERJAAN     :</span> {selectedKtpDetail.pekerjaan}</p>
              <p><span className="text-slate-500">KEWARGANEGARAAN:</span> {selectedKtpDetail.kewarganegaraan}</p>
              <p><span className="text-slate-500">DIBUAT PADA   :</span> {selectedKtpDetail.createdAt}</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button 
                onClick={() => copyToClipboard(JSON.stringify(selectedKtpDetail, null, 2))}
                className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <Copy className="w-4 h-4" /> Salin Format JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL EXPORT ================= */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setExportModalOpen(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">Ekspor Data Teks</h3>
                <p className="text-xs text-slate-400">Pilih format unduhan file</p>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button 
                onClick={() => { exportAsCSV(); setExportModalOpen(false); }}
                className="w-full flex items-center justify-between p-3.5 bg-slate-800/80 hover:bg-slate-800 border border-white/10 rounded-xl text-xs font-semibold text-emerald-400 transition-all"
              >
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" /> Unduh Format CSV (Excel)
                </span>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              <button 
                onClick={() => { exportAsJSON(); setExportModalOpen(false); }}
                className="w-full flex items-center justify-between p-3.5 bg-slate-800/80 hover:bg-slate-800 border border-white/10 rounded-xl text-xs font-semibold text-cyan-400 transition-all"
              >
                <span className="flex items-center gap-2">
                  <FileJson className="w-4 h-4" /> Unduh Format JSON
                </span>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL HAPUS DATA ================= */}
      {deleteModalConfig.show && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-center animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Konfirmasi Hapus</h3>
              <p className="text-xs text-slate-400 mt-1">
                Apakah Anda yakin menghapus <span className="text-rose-300 font-semibold">{deleteModalConfig.title}</span>?
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button 
                onClick={() => setDeleteModalConfig({ show: false, id: null, title: '' })}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs rounded-xl transition-all"
              >
                Batal
              </button>
              <button 
                onClick={confirmDelete}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-rose-600/20 transition-all"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= FLOATING TOAST ================= */}
      {toast.show && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl text-xs font-semibold ${
            toast.type === 'error' 
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-200 shadow-rose-950/50' 
              : 'bg-slate-900/90 border-cyan-500/40 text-cyan-200 shadow-cyan-950/50'
          }`}>
            {toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

    </div>
  );
}