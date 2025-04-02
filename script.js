import {
    HandLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

// Hàm tính khoảng cách giữa hai điểm
function calculateDistance(point1, point2) {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Hàm ánh xạ giá trị từ khoảng này sang khoảng khác
function mapValue(value, fromMin, fromMax, toMin, toMax) {
    return ((value - fromMin) * (toMax - toMin)) / (fromMax - fromMin) + toMin;
}

// Hàm đếm số ngón tay
function countFingers(landmarks, handedness) {
    let fingerCount = 0;
    
    // Đếm ngón cái (dựa vào vị trí ngang của điểm 4 so với điểm 3)
    if (handedness === "Right") {
        if (landmarks[4].x > landmarks[3].x) {
            fingerCount++;
        }
    } else { // Left hand
        if (landmarks[4].x < landmarks[3].x) {
            fingerCount++;
        }
    }
    
    // Đếm ngón trỏ (dựa vào vị trí dọc của điểm 8 so với điểm 6)
    if (landmarks[8].y < landmarks[6].y) {
        fingerCount++;
    }
    
    // Đếm ngón giữa (dựa vào vị trí dọc của điểm 12 so với điểm 10)
    if (landmarks[12].y < landmarks[10].y) {
        fingerCount++;
    }
    
    // Đếm ngón áp út (dựa vào vị trí dọc của điểm 16 so với điểm 14)
    if (landmarks[16].y < landmarks[14].y) {
        fingerCount++;
    }
    
    // Đếm ngón út (dựa vào vị trí dọc của điểm 20 so với điểm 18)
    if (landmarks[20].y < landmarks[18].y) {
        fingerCount++;
    }
    
    return fingerCount;
}

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], // thumb
    [0, 5], [5, 6], [6, 7], [7, 8], // index
    [0, 9], [9, 10], [10, 11], [11, 12], // middle
    [0, 13], [13, 14], [14, 15], [15, 16], // ring
    [0, 17], [17, 18], [18, 19], [19, 20] // pinky
];

let drawingUtils = new DrawingUtils();
let handLandmarker = undefined;
let runningMode = "VIDEO";
let enableWebcamButton;
let webcamRunning = false;

// Khởi tạo HandLandmarker
const createHandLandmarker = async () => {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        });
    } catch (error) {
        console.error("Lỗi khi khởi tạo HandLandmarker:", error);
    }
} 
// Đợi cho đến khi DOM được tải xong
document.addEventListener('DOMContentLoaded', () => {
    createHandLandmarker();
    
    // Khởi tạo các nút và sự kiện
    if (hasGetUserMedia()) {
        enableWebcamButton = document.getElementById("webcamButton");
        if (enableWebcamButton) {
            enableWebcamButton.addEventListener("click", enableCam);
        } else {
            console.warn("Không tìm thấy nút webcamButton");
        }
    } else {
        console.warn("Trình duyệt của bạn không hỗ trợ getUserMedia()");
    }
});
function updateJSONData(handData) {
    fetch('data.json', {
        method: 'PUT',  // Hoặc dùng GitHub Actions để cập nhật
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(handData)
    }).then(response => console.log("Dữ liệu cập nhật:", response));
}



/********************************************************************
// Xử lý webcam
********************************************************************/

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
let canvasCtx = null;

// Bật lật ngược video
video.style.transform = "scaleX(-1)";

// Khởi tạo canvas
function initCanvas() {
    if (!canvasElement) {
        console.error("Không tìm thấy phần tử canvas");
        return false;
    }
    
    canvasCtx = canvasElement.getContext("2d");
    if (!canvasCtx) {
        console.error("Không thể lấy context của canvas");
        return false;
    }
    
    // Khởi tạo lại DrawingUtils với context mới
    drawingUtils = new DrawingUtils(canvasCtx);
    return true;
}

// Kiểm tra hỗ trợ webcam
const hasGetUserMedia = () => !!navigator.mediaDevices?.getUserMedia;

// Bật/tắt webcam
function enableCam() {
    if (!handLandmarker) {
        console.log("Vui lòng đợi handLandmarker tải xong!");
        return;
    }

    webcamRunning = !webcamRunning;
    enableWebcamButton.innerText = webcamRunning ? "TẮT WEBCAM" : "BẬT WEBCAM";

    if (webcamRunning) {
        navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", () => {
                if (initCanvas()) {
                    predictWebcam();
                }
            });
        });
    }
}

let lastVideoTime = -1;
let results = undefined;

// Thêm biến để lưu trữ giá trị trước đó
let lastFingerCount = 0;
let lastBrightness = 0;

async function predictWebcam() {
    if (!canvasElement || !canvasCtx || !video.videoWidth) return;

    // Cập nhật kích thước canvas
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    canvasElement.style.width = `${video.videoWidth}px`;
    canvasElement.style.height = `${video.videoHeight}px`;
    
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = handLandmarker.detectForVideo(video, startTimeMs);
    }
    
    // Xóa và vẽ frame mới
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
    
    // Vẽ landmarks
    if (results?.landmarks) {
        for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i];
            const handedness = results.handednesses[i][0];
            
            if (landmarks?.length > 0) {
                try {
                    // Debug log để kiểm tra handedness
                    console.log(`Hand ${i}: ${handedness}`);
                    
                    // Xác định tay trái/phải dựa trên vị trí của bàn tay trên màn hình
                    const palmX = landmarks[0].x; // Vị trí x của điểm gốc bàn tay
                    const displayHandedness = palmX < 0.5 ? "Right" : "Left";
                    
                    // Tính khoảng cách giữa ngón cái và ngón trỏ
                    const thumbTip = landmarks[4]; // Điểm đầu ngón cái
                    const indexTip = landmarks[8]; // Điểm đầu ngón trỏ
                    const distance = calculateDistance(thumbTip, indexTip) * 1000; // Nhân với 1000 để có giá trị lớn hơn
                    
                    // Ánh xạ khoảng cách thành 8 mức độ sáng (0-255)
                    // Khoảng cách từ 0-1000 sẽ được chia thành 8 mức
                    let brightnessLevel;
                    if (distance < 56) brightnessLevel = 0;
                    else if (distance < 112) brightnessLevel = 36; 
                    else if (distance < 168) brightnessLevel = 73; 
                    else if (distance < 224) brightnessLevel = 109; 
                    else if (distance < 280) brightnessLevel = 146; 
                    else if (distance < 336) brightnessLevel = 182; 
                    else if (distance < 392) brightnessLevel = 218; 
                    else brightnessLevel = 255;                      
                    
                    const clampedBrightness = brightnessLevel;

                    
                    // Vẽ các đường kết nối
                    for (const connection of HAND_CONNECTIONS) {
                        const start = landmarks[connection[0]];
                        const end = landmarks[connection[1]];
                        canvasCtx.beginPath();
                        canvasCtx.moveTo(start.x * canvasElement.width, start.y * canvasElement.height);
                        canvasCtx.lineTo(end.x * canvasElement.width, end.y * canvasElement.height);
                        // Đổi màu cho rõ ràng hơn
                        canvasCtx.strokeStyle = displayHandedness === "Right" ? "#FF0000" : "#00FF00";
                        canvasCtx.lineWidth = 5;
                        canvasCtx.stroke();
                    }

                    // Vẽ các điểm landmarks
                    for (const landmark of landmarks) {
                        canvasCtx.beginPath();
                        canvasCtx.arc(
                            landmark.x * canvasElement.width,
                            landmark.y * canvasElement.height,
                            3,
                            0,
                            2 * Math.PI
                        );
                        // Đổi màu cho rõ ràng hơn
                        canvasCtx.fillStyle = displayHandedness === "Right" ? "#FF0000" : "#00FF00";
                        canvasCtx.fill();
                    }

                    // Vẽ nhãn tay và số ngón tay
                    const fingerCount = countFingers(landmarks, displayHandedness);
                    const labelX = landmarks[0].x * canvasElement.width;
                    const labelY = landmarks[0].y * canvasElement.height;
                    
                    canvasCtx.font = "bold 20px Arial";
                    let text;
                    if (displayHandedness === "Right") {
                        text = `Tay phải: ${fingerCount} ngón`;
                    } else {
                        text = `Tay trái: Độ sáng ${clampedBrightness}`;
                    }
                    console.log(`fingerCount: ${fingerCount}, LED Brightness: ${clampedBrightness}`);

                    const textWidth = canvasCtx.measureText(text).width;
                    const textX = labelX + 20;
                    
                    // Vẽ background cho text
                    canvasCtx.fillStyle = displayHandedness === "Right" ? "rgba(100, 66, 66, 0.5)" : "rgba(66, 95, 66, 0.5)";
                    canvasCtx.fillRect(textX - 5, labelY - 25, textWidth + 10, 30);
                    
                    // Lưu trạng thái canvas hiện tại
                    canvasCtx.save();
                    // Lật ngược text để hiển thị đúng chiều
                    canvasCtx.scale(-1, 1);
                    canvasCtx.translate(-textX - textWidth, labelY);
                    
                    // Vẽ text
                    canvasCtx.fillStyle = displayHandedness === "Right" ? "#FF0000" : "#00FF00";
                    canvasCtx.fillText(text, 0, 0);
                    
                    // Khôi phục trạng thái canvas
                    canvasCtx.restore();

                } catch (error) {
                    console.error("Lỗi khi vẽ landmarks:", error);
                }
            }
        }
    }

    if (webcamRunning) {
        window.requestAnimationFrame(predictWebcam);
    }
}
