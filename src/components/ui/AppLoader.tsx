import { motion } from "framer-motion";
import "./AppLoader.css";

export function AppLoader() {
  return (
    <div className="app-loader">
      <div className="app-loader-center">
        {/* Expanding pulse rings */}
        <span className="app-loader-ring app-loader-ring--1" />
        <span className="app-loader-ring app-loader-ring--2" />
        <span className="app-loader-ring app-loader-ring--3" />

        {/* Logo card */}
        <motion.div
          className="app-loader-logo"
          initial={{ scale: 0.65, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.55, ease: [0.34, 1.46, 0.64, 1] }}
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="app-loader-svg"
          >
            {/* Green card */}
            <motion.path
              d="m77 257c0-99.411 80.589-180 180-180h510c99.411 0 180 80.589 180 180v510c0 99.411-80.589 180-180 180h-510c-99.411 0-180-80.589-180-180z"
              fill="#6b8f6e"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            />

            {/* Mic capsule — draws in */}
            <motion.path
              d="m511.776 269.012c-21.51 0-42.138 8.54-57.348 23.741s-23.754 35.818-23.754 57.316v216.153c0 21.498 8.544 42.116 23.754 57.317s35.838 23.741 57.348 23.741 42.139-8.54 57.348-23.741c15.21-15.201 23.755-35.819 23.755-57.317v-216.153c0-21.498-8.545-42.115-23.755-57.316-15.209-15.201-35.838-23.741-57.348-23.741z"
              stroke="#fff"
              strokeWidth="30"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.75, delay: 0.35, ease: "easeOut" }}
            />

            {/* Mic stand / arc — draws in after capsule */}
            <motion.path
              d="m701.016 512.184v54.038c0 50.162-19.938 98.269-55.427 133.738-35.49 35.47-83.623 55.396-133.813 55.396-50.189 0-98.323-19.926-133.812-55.396-35.489-35.469-55.427-83.576-55.427-133.738v-54.038"
              stroke="#fff"
              strokeWidth="30"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.95, ease: "easeOut" }}
            />
          </svg>
        </motion.div>
      </div>

      {/* App name */}
      <motion.p
        className="app-loader-name"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.4, ease: "easeOut" }}
      >
        Lexi
      </motion.p>
    </div>
  );
}
